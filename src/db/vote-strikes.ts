import { COMMUNITY_KEY_ID, config } from "@/config"
import {
	awardStrikePenaltyXp,
	revokeConfidenceXp,
	revokeStrikePenaltyXp,
} from "@/db/contribution-events"
import { recordCouncilEvent } from "@/db/council-events"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("db")

export interface SuspectKey {
	userId: number
	submitterId: number
	votes: number
	ring: boolean
	serial: boolean
	lastVoteAt: number
}

export async function findSuspectKeys(
	env: Env,
	opts: { now?: number; all?: boolean } = {}
): Promise<SuspectKey[]> {
	const { freshSec, devotedShare, ring, serialMinVotes, serialWindowSec, lookbackSec } =
		config.voteIntegrity
	const now = opts.now ?? Math.floor(Date.now() / 1000)
	const baselineStart = now - ring.baselineSec
	const loadSince = opts.all ? 0 : Math.min(baselineStart, now - lookbackSec - ring.windowSec)
	const candidateSince = opts.all ? 0 : now - lookbackSec
	const res = await env.DB.prepare(`
		WITH active AS (
			SELECT DISTINCT user_id FROM votes WHERE vote = 1 AND created_at >= ?::int
		),
		counted AS (
			SELECT v.user_id, l.submitter_id AS sid, v.created_at
			FROM active a
			JOIN votes v ON v.user_id = a.user_id
			JOIN lyrics l ON l.id = v.lyrics_id
			JOIN users u ON u.id = v.user_id
			JOIN users s ON s.id = l.submitter_id
			WHERE v.is_self_vote = 0 AND v.vote = 1 AND u.banned_at IS NULL AND s.key_id <> ?
		),
		per_key AS (
			SELECT user_id, COUNT(*) AS total, MIN(created_at) AS first_vote,
				MAX(created_at) >= ?::int AS candidate
			FROM counted GROUP BY user_id
		),
		devoted AS (
			SELECT c.user_id, c.sid, COUNT(*) AS n, MIN(c.created_at) AS first_on_sid,
				MAX(c.created_at) AS last_vote, k.first_vote, k.candidate,
				(k.first_vote - u.created_at) < ? AS fresh
			FROM counted c
			JOIN per_key k ON k.user_id = c.user_id
			JOIN users u ON u.id = c.user_id
			GROUP BY c.user_id, c.sid, k.total, k.first_vote, k.candidate, u.created_at
			HAVING COUNT(*) >= ?::float8 * k.total
		),
		baseline AS (
			SELECT sid, COUNT(*) AS fresh_keys
			FROM devoted
			WHERE fresh AND first_on_sid >= ?::int AND first_on_sid < ?::int
			GROUP BY sid
		),
		rings AS (
			SELECT a.user_id, a.sid
			FROM devoted a
			JOIN devoted b ON b.sid = a.sid AND b.fresh AND ABS(b.first_vote - a.first_vote) <= ?
			LEFT JOIN baseline bl ON bl.sid = a.sid
			WHERE a.fresh AND a.candidate
			GROUP BY a.user_id, a.sid, bl.fresh_keys
			HAVING COUNT(*) >= GREATEST(?::int,
				CEIL(?::float8 * COALESCE(bl.fresh_keys, 0) * ?::int / ?::int))
		),
		bursts AS (
			SELECT user_id, sid, MAX(in_window) AS peak
			FROM (
				SELECT c.user_id, c.sid, COUNT(*) OVER (
					PARTITION BY c.user_id, c.sid ORDER BY c.created_at
					RANGE BETWEEN CURRENT ROW AND ?::int FOLLOWING
				) AS in_window
				FROM counted c
				JOIN devoted d ON d.user_id = c.user_id AND d.sid = c.sid
				WHERE d.fresh AND d.candidate
			) w
			GROUP BY user_id, sid
		)
		SELECT d.user_id, d.sid, d.n, d.last_vote, (r.user_id IS NOT NULL) AS ring,
			COALESCE(b.peak >= ?, FALSE) AS serial
		FROM devoted d
		JOIN users u ON u.id = d.user_id
		LEFT JOIN rings r ON r.user_id = d.user_id AND r.sid = d.sid
		LEFT JOIN bursts b ON b.user_id = d.user_id AND b.sid = d.sid
		WHERE d.candidate AND u.votes_discounted_at IS NULL AND u.vote_strike_id IS NULL
			AND (r.user_id IS NOT NULL OR b.peak >= ?)
	`)
		.bind(
			loadSince,
			COMMUNITY_KEY_ID,
			candidateSince,
			freshSec,
			devotedShare,
			baselineStart,
			now,
			ring.windowSec,
			ring.minKeys,
			ring.trafficFactor,
			ring.windowSec,
			ring.baselineSec,
			serialWindowSec,
			serialMinVotes,
			serialMinVotes
		)
		.all<{
			user_id: number
			sid: number
			n: number | string
			last_vote: number
			ring: boolean
			serial: boolean
		}>()
	return (res.results || []).map((r) => ({
		userId: r.user_id,
		submitterId: r.sid,
		votes: Number(r.n),
		ring: r.ring,
		serial: r.serial,
		lastVoteAt: r.last_vote,
	}))
}

type StrikeKind = "ring" | "serial" | "both"

export interface RecordedStrike {
	strikeId: number
	submitterId: number
	created: boolean
	repeat: boolean
	keyIds: number[]
}

function kindOf(suspects: SuspectKey[]): StrikeKind {
	const ring = suspects.some((s) => s.ring)
	const serial = suspects.some((s) => s.serial)
	if (ring && serial) return "both"
	return ring ? "ring" : "serial"
}

const mergeKinds = (a: StrikeKind, b: StrikeKind): StrikeKind => (a === b ? a : "both")

export async function recordStrikes(
	env: Env,
	suspects: SuspectKey[],
	now = Math.floor(Date.now() / 1000)
): Promise<RecordedStrike[]> {
	const bySubmitter = new Map<number, SuspectKey[]>()
	for (const suspect of suspects) {
		const group = bySubmitter.get(suspect.submitterId)
		if (group) group.push(suspect)
		else bySubmitter.set(suspect.submitterId, [suspect])
	}
	const recorded: RecordedStrike[] = []
	for (const [submitterId, group] of bySubmitter) {
		try {
			const strike = await env.DB.transaction((tx) =>
				recordSubmitterStrike({ ...env, DB: tx }, submitterId, group, now)
			)
			if (strike) recorded.push(strike)
		} catch (err) {
			log.error("failed to record vote strike", { submitterId, error: String(err) })
		}
	}
	return recorded
}

async function recordSubmitterStrike(
	txEnv: Env,
	submitterId: number,
	suspects: SuspectKey[],
	now: number
): Promise<RecordedStrike | null> {
	const { mergeWindowSec, launchedAt } = config.voteIntegrity
	const tx = txEnv.DB
	await tx.prepare("SELECT id FROM users WHERE id = ? FOR UPDATE").bind(submitterId).run()
	const undiscounted = await tx
		.prepare(
			"SELECT id FROM users WHERE id = ANY(?::int[]) AND votes_discounted_at IS NULL FOR UPDATE"
		)
		.bind(suspects.map((s) => s.userId))
		.all<{ id: number }>()
	const open = new Set(undiscounted.results.map((r) => r.id))
	const keys = suspects.filter((s) => open.has(s.userId))
	if (keys.length === 0) return null

	const keyIds = keys.map((k) => k.userId)
	const votes = keys.reduce((sum, k) => sum + k.votes, 0)
	const kind = kindOf(keys)
	const latest = await tx
		.prepare(
			`SELECT id, kind, detected_at, repeat FROM vote_strikes
			WHERE submitter_id = ? AND undone_at IS NULL AND NOT backfill
			ORDER BY detected_at DESC, id DESC LIMIT 1`
		)
		.bind(submitterId)
		.first<{ id: number; kind: StrikeKind; detected_at: number; repeat: boolean }>()

	let strike: Omit<RecordedStrike, "submitterId" | "keyIds">
	if (latest && now - latest.detected_at <= mergeWindowSec) {
		await tx
			.prepare(
				`UPDATE vote_strikes SET key_count = key_count + ?, vote_count = vote_count + ?, kind = ?,
					settled_at = NULL
				WHERE id = ?`
			)
			.bind(keys.length, votes, mergeKinds(latest.kind, kind), latest.id)
			.run()
		strike = { strikeId: latest.id, created: false, repeat: latest.repeat }
	} else {
		const lastVoteAt = keys.reduce((max, k) => Math.max(max, k.lastVoteAt), 0)
		const backfill = lastVoteAt < launchedAt
		const repeat = !backfill && latest !== null
		const inserted = await tx
			.prepare(
				`INSERT INTO vote_strikes (submitter_id, kind, detected_at, key_count, vote_count, repeat, backfill)
				VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
			)
			.bind(submitterId, kind, now, keys.length, votes, repeat, backfill)
			.first<{ id: number }>()
		if (!inserted) throw new Error(`vote strike insert returned no row for ${submitterId}`)
		strike = { strikeId: inserted.id, created: true, repeat }
		if (repeat) await awardStrikePenaltyXp(txEnv, submitterId, inserted.id)
		await recordCouncilEvent(tx, {
			actorId: null,
			kind: "vote_strike",
			source: "system",
			subjectUserId: submitterId,
			refId: inserted.id,
			note: strikeNote({ kind, keyCount: keys.length, voteCount: votes, repeat, backfill }),
			at: now,
		})
	}

	await tx
		.prepare(
			`UPDATE users SET votes_discounted_at = ?, vote_strike_id = ?
			WHERE id = ANY(?::int[]) AND votes_discounted_at IS NULL`
		)
		.bind(now, strike.strikeId, keyIds)
		.run()
	return { ...strike, submitterId, keyIds }
}

export async function revokeStrikeXp(env: Env, strikeId: number): Promise<number> {
	return env.DB.transaction(async (tx) => {
		const strike = await tx
			.prepare(
				"SELECT submitter_id FROM vote_strikes WHERE id = ? AND undone_at IS NULL FOR UPDATE"
			)
			.bind(strikeId)
			.first<{ submitter_id: number }>()
		if (!strike) return 0
		const targets = await tx
			.prepare(
				`SELECT DISTINCT l.id
				FROM users u
				JOIN votes v ON v.user_id = u.id
				JOIN lyrics l ON l.id = v.lyrics_id
				WHERE u.vote_strike_id = ? AND l.submitter_id = ? AND l.deleted_at IS NULL`
			)
			.bind(strikeId, strike.submitter_id)
			.all<{ id: number }>()
		const xp = await revokeConfidenceXp(
			{ ...env, DB: tx },
			strike.submitter_id,
			targets.results.map((r) => r.id)
		)
		if (xp !== 0) {
			await tx
				.prepare("UPDATE vote_strikes SET xp_revoked = xp_revoked + ? WHERE id = ?")
				.bind(xp, strikeId)
				.run()
		}
		return xp
	})
}

export interface UnsettledStrike {
	id: number
	submitterId: number
	submitterKeyId: string
	repeat: boolean
	keyCount: number
	keyIds: number[]
}

export async function unsettledStrikes(env: Env): Promise<UnsettledStrike[]> {
	const res = await env.DB.prepare(
		`SELECT s.id, s.submitter_id, sub.key_id, s.repeat, s.key_count,
			ARRAY(SELECT u.id FROM users u WHERE u.vote_strike_id = s.id ORDER BY u.id) AS key_ids
		FROM vote_strikes s
		JOIN users sub ON sub.id = s.submitter_id
		WHERE s.settled_at IS NULL AND s.undone_at IS NULL
		ORDER BY s.id`
	).all<{
		id: number
		submitter_id: number
		key_id: string
		repeat: boolean
		key_count: number
		key_ids: number[]
	}>()
	return res.results.map((r) => ({
		id: r.id,
		submitterId: r.submitter_id,
		submitterKeyId: r.key_id,
		repeat: r.repeat,
		keyCount: r.key_count,
		keyIds: r.key_ids,
	}))
}

export async function markStrikeSettled(
	env: Env,
	strike: Pick<UnsettledStrike, "id" | "keyCount">,
	now: number
): Promise<void> {
	await env.DB.prepare(
		"UPDATE vote_strikes SET settled_at = ? WHERE id = ? AND key_count = ? AND undone_at IS NULL"
	)
		.bind(now, strike.id, strike.keyCount)
		.run()
}

export type UndoStrikeResult = "undone" | "not_found" | "already_undone"

export interface UndoneStrike {
	result: UndoStrikeResult
	keyIds: number[]
	submitterId: number | null
	submitterKeyId: string | null
	repeatChanged: boolean
}

export async function undoStrike(
	env: Env,
	strikeId: number,
	actorId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<UndoneStrike> {
	const unchanged = (result: UndoStrikeResult): UndoneStrike => ({
		result,
		keyIds: [],
		submitterId: null,
		submitterKeyId: null,
		repeatChanged: false,
	})
	return env.DB.transaction(async (tx) => {
		const submitter = await tx
			.prepare(
				`SELECT u.id, u.key_id FROM vote_strikes s JOIN users u ON u.id = s.submitter_id
				WHERE s.id = ? FOR UPDATE OF u`
			)
			.bind(strikeId)
			.first<{ id: number; key_id: string }>()
		if (!submitter) return unchanged("not_found")
		const strike = await tx
			.prepare("SELECT detected_at, repeat, undone_at FROM vote_strikes WHERE id = ? FOR UPDATE")
			.bind(strikeId)
			.first<{ detected_at: number; repeat: boolean; undone_at: number | null }>()
		if (!strike) return unchanged("not_found")
		if (strike.undone_at !== null) return unchanged("already_undone")

		await tx
			.prepare("UPDATE vote_strikes SET undone_at = ?, undone_by = ? WHERE id = ?")
			.bind(now, actorId, strikeId)
			.run()
		const keys = await tx
			.prepare("UPDATE users SET votes_discounted_at = NULL WHERE vote_strike_id = ? RETURNING id")
			.bind(strikeId)
			.all<{ id: number }>()
		const txEnv = { ...env, DB: tx }
		await revokeStrikePenaltyXp(txEnv, strikeId)
		const lifted = await liftLaterRepeats(txEnv, submitter.id, strikeId, strike.detected_at)
		await recordCouncilEvent(tx, {
			actorId,
			kind: "vote_strike_undo",
			source: "web",
			subjectUserId: submitter.id,
			refId: strikeId,
			note: null,
			at: now,
		})
		return {
			result: "undone",
			keyIds: keys.results.map((k) => k.id).sort((a, b) => a - b),
			submitterId: submitter.id,
			submitterKeyId: submitter.key_id,
			repeatChanged: strike.repeat || lifted > 0,
		}
	})
}

async function liftLaterRepeats(
	txEnv: Env,
	submitterId: number,
	undoneId: number,
	undoneAt: number
): Promise<number> {
	const live = await txEnv.DB.prepare(
		`SELECT id, detected_at, repeat, backfill FROM vote_strikes
		WHERE submitter_id = ? AND undone_at IS NULL
		ORDER BY detected_at, id FOR UPDATE`
	)
		.bind(submitterId)
		.all<{ id: number; detected_at: number; repeat: boolean; backfill: boolean }>()
	let earlierLive = false
	let lifted = 0
	for (const s of live.results) {
		const later = s.detected_at > undoneAt || (s.detected_at === undoneAt && s.id > undoneId)
		if (later && s.repeat && !earlierLive) {
			await txEnv.DB.prepare("UPDATE vote_strikes SET repeat = FALSE WHERE id = ?").bind(s.id).run()
			await revokeStrikePenaltyXp(txEnv, s.id)
			lifted++
		}
		if (!s.backfill) earlierLive = true
	}
	return lifted
}

export async function votersOn(env: Env, lyricsIds: number[]): Promise<number[]> {
	if (lyricsIds.length === 0) return []
	const res = await env.DB.prepare(
		"SELECT DISTINCT user_id FROM votes WHERE lyrics_id = ANY(?::int[]) ORDER BY user_id"
	)
		.bind(lyricsIds)
		.all<{ user_id: number }>()
	return res.results.map((r) => r.user_id)
}

export async function lyricsVotedByKeys(env: Env, keyIds: number[]): Promise<number[]> {
	if (keyIds.length === 0) return []
	const res = await env.DB.prepare(
		`SELECT DISTINCT l.id FROM votes v
		JOIN lyrics l ON l.id = v.lyrics_id
		WHERE v.user_id = ANY(?::int[]) AND l.deleted_at IS NULL
		ORDER BY l.id`
	)
		.bind(keyIds)
		.all<{ id: number }>()
	return res.results.map((r) => r.id)
}

export interface StrikeSummary {
	kind: string
	keyCount: number
	voteCount: number
	repeat: boolean
	backfill: boolean
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

export function strikeNote(s: StrikeSummary): string {
	const base = `${s.kind}: ${count(s.keyCount, "key")}, ${count(s.voteCount, "vote")}`
	if (s.repeat) return `${base} (repeat)`
	return s.backfill ? `${base} (history before launch)` : base
}

export async function hasAnyStrike(env: Env): Promise<boolean> {
	return (await env.DB.prepare("SELECT 1 FROM vote_strikes LIMIT 1").first()) !== null
}
