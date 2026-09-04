import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import { getCuratorRank } from "@/db/leaderboard"
import { invalidateCache } from "@/db/lyrics"
import type { Env } from "@/types"
import { quotaForTier } from "@/utils/boost-quota"

export interface BoostQuota {
	quota: number
	used: number
	remaining: number
	resetsAt: number
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
	  }

export type RevokeResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" }

function monthWindow(): { monthStart: number; resetsAt: number } {
	const now = new Date()
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	return {
		monthStart: Math.floor(Date.UTC(year, month, 1) / 1000),
		resetsAt: Math.floor(Date.UTC(year, month + 1, 1) / 1000),
	}
}

export async function getQuota(env: Env, boosterId: number): Promise<BoostQuota> {
	const userRow = await env.DB.prepare("SELECT key_id FROM users WHERE id = ?")
		.bind(boosterId)
		.first<{ key_id: string }>()
	const tier = userRow ? ((await getCuratorRank(env, userRow.key_id))?.tier ?? null) : null
	const quota = quotaForTier(tier, config.gamification.boost)

	const { monthStart, resetsAt } = monthWindow()
	const countRow = await env.DB.prepare(
		"SELECT COUNT(*) AS n FROM boosts WHERE booster_id = ? AND revoked_at IS NULL AND created_at >= ?"
	)
		.bind(boosterId, monthStart)
		.first<{ n: number | string }>()
	const used = Number(countRow?.n ?? 0)
	return { quota, used, remaining: Math.max(0, quota - used), resetsAt }
}

export async function createBoost(
	env: Env,
	boosterId: number,
	lyricsId: number
): Promise<BoostResult> {
	if (!(await isCommittee(env, boosterId))) {
		return { ok: false, reason: "not_committee" }
	}

	const lyric = await env.DB.prepare(
		"SELECT video_id, submitter_id, committee_approved_at FROM lyrics WHERE id = ? AND deleted_at IS NULL"
	)
		.bind(lyricsId)
		.first<{
			video_id: string
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

	const { quota, used } = await getQuota(env, boosterId)
	if (used >= quota) {
		return { ok: false, reason: "over_quota" }
	}

	const active = await env.DB.prepare(
		"SELECT 1 AS one FROM boosts WHERE lyrics_id = ? AND revoked_at IS NULL"
	)
		.bind(lyricsId)
		.first<{ one: number }>()
	if (active) {
		return { ok: false, reason: "already_boosted" }
	}

	const nowEpoch = Math.floor(Date.now() / 1000)
	await env.DB.prepare("INSERT INTO boosts (booster_id, lyrics_id) VALUES (?, ?)")
		.bind(boosterId, lyricsId)
		.run()
	await env.DB.prepare(
		"UPDATE lyrics SET committee_approved_at = ?, committee_approved_by = ? WHERE id = ?"
	)
		.bind(nowEpoch, boosterId, lyricsId)
		.run()
	await invalidateCache(env, lyric.video_id)

	return { ok: true, quota: await getQuota(env, boosterId) }
}

export async function revokeBoost(
	env: Env,
	actorId: number,
	lyricsId: number
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

	const nowEpoch = Math.floor(Date.now() / 1000)
	await env.DB.prepare("UPDATE boosts SET revoked_at = ? WHERE id = ?")
		.bind(nowEpoch, boost.id)
		.run()
	await env.DB.prepare(
		"UPDATE lyrics SET committee_approved_at = NULL, committee_approved_by = NULL WHERE id = ?"
	)
		.bind(lyricsId)
		.run()

	const videoRow = await env.DB.prepare("SELECT video_id FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ video_id: string }>()
	if (videoRow) {
		await invalidateCache(env, videoRow.video_id)
	}

	return { ok: true }
}
