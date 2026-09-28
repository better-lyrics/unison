import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import { releaseBookmarksForItem } from "@/db/council-bookmarks"
import { type CouncilSource, recordCouncilEvent } from "@/db/council-events"
import { invalidateCacheForLyric } from "@/db/lyrics"
import { AUTO_HIDE_PREDICATE_JOINED } from "@/db/predicates"
import { isUniqueViolation } from "@/infra/database"
import type { Env } from "@/types"
import { type BoostQuotaConfig, quotaForBasis } from "@/utils/boost-quota"

export interface BoostQuota {
	quota: number
	used: number
	remaining: number
	resetsAt: number
	basis: { active: boolean; upvotedLyrics: number; bonus: number; monthStart: number }
	rule: BoostQuotaConfig
}

export type BoostResult =
	| { ok: true; quota: BoostQuota }
	| {
			ok: false
			reason:
				| "not_committee"
				| "lyric_not_found"
				| "self"
				| "target_committee"
				| "over_quota"
				| "already_boosted"
				| "rejected"
	  }

export type RevokeResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" }

export function monthWindow(at = Date.now()): {
	lastMonthStart: number
	monthStart: number
	resetsAt: number
} {
	const now = new Date(at)
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	return {
		lastMonthStart: Math.floor(Date.UTC(year, month - 1, 1) / 1000),
		monthStart: Math.floor(Date.UTC(year, month, 1) / 1000),
		resetsAt: Math.floor(Date.UTC(year, month + 1, 1) / 1000),
	}
}

export async function getQuota(env: Env, boosterId: number): Promise<BoostQuota> {
	const { lastMonthStart, monthStart, resetsAt } = monthWindow()
	const row = await env.DB.prepare(
		`SELECT
		   (SELECT COUNT(*) FROM boosts
		     WHERE booster_id = ? AND revoked_at IS NULL AND created_at >= ?) AS used,
		   EXISTS (SELECT 1 FROM committee_members WHERE user_id = ? AND added_at >= ?) AS joined_recently,
		   COUNT(l.id) AS lyrics,
		   COUNT(l.id) FILTER (WHERE l.effective_score > 0) AS upvoted
		 FROM lyrics l
		 WHERE l.submitter_id = ? AND l.created_at >= ? AND l.created_at < ?
		   AND l.deleted_at IS NULL
		   AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
		   AND NOT EXISTS (SELECT 1 FROM rejections rj WHERE rj.lyrics_id = l.id AND rj.revoked_at IS NULL)`
	)
		.bind(boosterId, monthStart, boosterId, lastMonthStart, boosterId, lastMonthStart, monthStart)
		.first<{
			used: number | string
			joined_recently: boolean
			lyrics: number | string
			upvoted: number | string
		}>()
	const used = Number(row?.used ?? 0)
	const active = Boolean(row?.joined_recently) || Number(row?.lyrics ?? 0) > 0
	const upvotedLyrics = Number(row?.upvoted ?? 0)
	const rule = config.gamification.boost.quota
	const { quota, bonus } = quotaForBasis({ active, upvotedLyrics }, rule)
	return {
		quota,
		used,
		remaining: Math.max(0, quota - used),
		resetsAt,
		basis: { active, upvotedLyrics, bonus, monthStart: lastMonthStart },
		rule,
	}
}

export async function createBoost(
	env: Env,
	boosterId: number,
	lyricsId: number,
	source: CouncilSource
): Promise<BoostResult> {
	if (!(await isCommittee(env, boosterId))) {
		return { ok: false, reason: "not_committee" }
	}

	const lyric = await env.DB.prepare(
		"SELECT submitter_id, committee_approved_at FROM lyrics WHERE id = ? AND deleted_at IS NULL"
	)
		.bind(lyricsId)
		.first<{
			submitter_id: number | string | null
			committee_approved_at: number | null
		}>()
	if (!lyric) {
		return { ok: false, reason: "lyric_not_found" }
	}

	const submitterId = lyric.submitter_id == null ? null : Number(lyric.submitter_id)
	if (submitterId === boosterId) {
		return { ok: false, reason: "self" }
	}
	if (submitterId != null && (await isCommittee(env, submitterId))) {
		return { ok: false, reason: "target_committee" }
	}

	let result: BoostResult
	try {
		result = await env.DB.transaction(async (tx): Promise<BoostResult> => {
			const txEnv = { ...env, DB: tx }
			await tx.prepare("SELECT id FROM lyrics WHERE id = ? FOR UPDATE").bind(lyricsId).run()
			await tx.prepare("SELECT id FROM users WHERE id = ? FOR UPDATE").bind(boosterId).run()

			const rejected = await tx
				.prepare("SELECT 1 AS one FROM rejections WHERE lyrics_id = ? AND revoked_at IS NULL")
				.bind(lyricsId)
				.first<{ one: number }>()
			if (rejected) {
				return { ok: false, reason: "rejected" }
			}

			const before = await getQuota(txEnv, boosterId)
			if (before.used >= before.quota) {
				return { ok: false, reason: "over_quota" }
			}

			const active = await tx
				.prepare("SELECT 1 AS one FROM boosts WHERE lyrics_id = ? AND revoked_at IS NULL")
				.bind(lyricsId)
				.first<{ one: number }>()
			if (active) {
				return { ok: false, reason: "already_boosted" }
			}

			const nowEpoch = Math.floor(Date.now() / 1000)
			const boost = await tx
				.prepare("INSERT INTO boosts (booster_id, lyrics_id) VALUES (?, ?) RETURNING id")
				.bind(boosterId, lyricsId)
				.first<{ id: number | string }>()
			await tx
				.prepare(
					"UPDATE lyrics SET committee_approved_at = ?, committee_approved_by = ? WHERE id = ?"
				)
				.bind(nowEpoch, boosterId, lyricsId)
				.run()
			await recordCouncilEvent(tx, {
				actorId: boosterId,
				kind: "seal",
				source,
				lyricsId,
				refId: Number(boost?.id),
				at: nowEpoch,
			})
			await releaseBookmarksForItem(tx, "seal", lyricsId)

			const used = before.used + 1
			return {
				ok: true,
				quota: { ...before, used, remaining: Math.max(0, before.quota - used) },
			}
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return { ok: false, reason: "already_boosted" }
		}
		throw err
	}

	if (result.ok) {
		await invalidateCacheForLyric(env, lyricsId)
	}
	return result
}

async function clearBoost(
	env: Env,
	boostId: number,
	lyricsId: number,
	actorId: number | null,
	source: CouncilSource
): Promise<void> {
	const nowEpoch = Math.floor(Date.now() / 1000)
	await env.DB.transaction(async (tx) => {
		await tx.prepare("UPDATE boosts SET revoked_at = ? WHERE id = ?").bind(nowEpoch, boostId).run()
		await tx
			.prepare(
				"UPDATE lyrics SET committee_approved_at = NULL, committee_approved_by = NULL WHERE id = ?"
			)
			.bind(lyricsId)
			.run()
		await recordCouncilEvent(tx, {
			actorId,
			kind: "unseal",
			source,
			lyricsId,
			refId: boostId,
			at: nowEpoch,
		})
	})

	await invalidateCacheForLyric(env, lyricsId)
}

export async function revokeBoost(
	env: Env,
	actorId: number,
	lyricsId: number,
	source: CouncilSource
): Promise<RevokeResult> {
	const boost = await env.DB.prepare(
		"SELECT id, booster_id FROM boosts WHERE lyrics_id = ? AND revoked_at IS NULL"
	)
		.bind(lyricsId)
		.first<{ id: number; booster_id: number | string }>()
	if (!boost) {
		return { ok: false, reason: "not_found" }
	}
	if (Number(boost.booster_id) !== actorId) {
		return { ok: false, reason: "forbidden" }
	}

	await clearBoost(env, boost.id, lyricsId, actorId, source)
	return { ok: true }
}

export async function revokeBoostByAdmin(env: Env, lyricsId: number): Promise<RevokeResult> {
	const boost = await env.DB.prepare(
		"SELECT id FROM boosts WHERE lyrics_id = ? AND revoked_at IS NULL"
	)
		.bind(lyricsId)
		.first<{ id: number }>()
	if (!boost) {
		return { ok: false, reason: "not_found" }
	}

	await clearBoost(env, boost.id, lyricsId, null, "admin")
	return { ok: true }
}
