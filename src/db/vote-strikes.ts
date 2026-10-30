import { COMMUNITY_KEY_ID, config } from "@/config"
import { revokeStrikePenaltyXp } from "@/db/contribution-events"
import { recordCouncilEvent } from "@/db/council-events"
import type { D1Compat } from "@/infra/database"
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

export async function findSuspectKeys(env: Env): Promise<SuspectKey[]> {
	const { freshSec, devotedShare, ring, serialMinVotes } = config.voteIntegrity
	// Full scan of votes; restrict to voters active since the last run once votes passes ~1M rows.
	const res = await env.DB.prepare(`
		WITH counted AS (
			SELECT v.user_id, l.submitter_id AS sid, v.created_at
			FROM votes v
			JOIN lyrics l ON l.id = v.lyrics_id
			JOIN users u ON u.id = v.user_id
			JOIN users s ON s.id = l.submitter_id
			WHERE v.is_self_vote = 0 AND u.banned_at IS NULL AND s.key_id <> ?
		),
		per_key AS (
			SELECT user_id, COUNT(*) AS total, MIN(created_at) AS first_vote FROM counted GROUP BY user_id
		),
		devoted AS (
			SELECT c.user_id, c.sid, COUNT(*) AS n, MAX(c.created_at) AS last_vote, k.first_vote,
				(k.first_vote - u.created_at) < ? AS fresh
			FROM counted c
			JOIN per_key k ON k.user_id = c.user_id
			JOIN users u ON u.id = c.user_id
			GROUP BY c.user_id, c.sid, k.total, k.first_vote, u.created_at
			HAVING COUNT(*) >= ?::float8 * k.total
		),
		rings AS (
			SELECT a.user_id, a.sid
			FROM devoted a
			JOIN devoted b ON b.sid = a.sid AND b.fresh AND ABS(b.first_vote - a.first_vote) <= ?
			WHERE a.fresh
			GROUP BY a.user_id, a.sid
			HAVING COUNT(*) >= ?
		)
		SELECT d.user_id, d.sid, d.n, d.last_vote, (r.user_id IS NOT NULL) AS ring, d.n >= ? AS serial
		FROM devoted d
		JOIN users u ON u.id = d.user_id
		LEFT JOIN rings r ON r.user_id = d.user_id AND r.sid = d.sid
		WHERE u.votes_discounted_at IS NULL AND u.vote_strike_id IS NULL AND (r.user_id IS NOT NULL OR d.n >= ?)
	`)
		.bind(
			COMMUNITY_KEY_ID,
			freshSec,
			devotedShare,
			ring.windowSec,
			ring.minKeys,
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
				recordSubmitterStrike(tx, submitterId, group, now)
			)
			if (strike) recorded.push(strike)
		} catch (err) {
			log.error("failed to record vote strike", { submitterId, error: String(err) })
		}
	}
	return recorded
}

async function recordSubmitterStrike(
	tx: D1Compat,
	submitterId: number,
	suspects: SuspectKey[],
	now: number
): Promise<RecordedStrike | null> {
	const { mergeWindowSec, launchedAt } = config.voteIntegrity
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
			WHERE submitter_id = ? AND undone_at IS NULL
			ORDER BY detected_at DESC, id DESC LIMIT 1`
		)
		.bind(submitterId)
		.first<{ id: number; kind: StrikeKind; detected_at: number; repeat: boolean }>()

	let strike: Omit<RecordedStrike, "submitterId" | "keyIds">
	if (latest && now - latest.detected_at <= mergeWindowSec) {
		await tx
			.prepare(
				"UPDATE vote_strikes SET key_count = key_count + ?, vote_count = vote_count + ?, kind = ? WHERE id = ?"
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
	const row = await env.DB.prepare(`
		WITH strike AS (
			SELECT id, submitter_id FROM vote_strikes WHERE id = ? AND undone_at IS NULL
		),
		targets AS (
			SELECT DISTINCT l.id
			FROM strike s
			JOIN users u ON u.vote_strike_id = s.id
			JOIN votes v ON v.user_id = u.id
			JOIN lyrics l ON l.id = v.lyrics_id AND l.submitter_id = s.submitter_id
			WHERE l.deleted_at IS NULL AND l.confidence = 'low'
		),
		removed AS (
			DELETE FROM contribution_events e
			USING strike s
			WHERE e.user_id = s.submitter_id
				AND e.ref_type = 'lyric'
				AND e.ref_id IN (SELECT id FROM targets)
				AND e.kind IN ('reached-medium', 'reached-high', 'first-for-song')
			RETURNING e.delta
		),
		total AS (SELECT COALESCE(SUM(delta), 0)::int AS xp FROM removed)
		UPDATE vote_strikes SET xp_revoked = xp_revoked + (SELECT xp FROM total)
		WHERE id IN (SELECT id FROM strike)
		RETURNING (SELECT xp FROM total) AS xp
	`)
		.bind(strikeId)
		.first<{ xp: number }>()
	return row?.xp ?? 0
}

export type UndoStrikeResult = "undone" | "not_found" | "already_undone"

export async function undoStrike(
	env: Env,
	strikeId: number,
	actorId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<{ result: UndoStrikeResult; keyIds: number[] }> {
	return env.DB.transaction(async (tx) => {
		const strike = await tx
			.prepare("SELECT submitter_id, undone_at FROM vote_strikes WHERE id = ? FOR UPDATE")
			.bind(strikeId)
			.first<{ submitter_id: number; undone_at: number | null }>()
		if (!strike) return { result: "not_found", keyIds: [] }
		if (strike.undone_at !== null) return { result: "already_undone", keyIds: [] }

		await tx
			.prepare("UPDATE vote_strikes SET undone_at = ?, undone_by = ? WHERE id = ?")
			.bind(now, actorId, strikeId)
			.run()
		const keys = await tx
			.prepare("UPDATE users SET votes_discounted_at = NULL WHERE vote_strike_id = ? RETURNING id")
			.bind(strikeId)
			.all<{ id: number }>()
		await revokeStrikePenaltyXp({ ...env, DB: tx }, strikeId)
		await recordCouncilEvent(tx, {
			actorId,
			kind: "vote_strike_undo",
			source: "web",
			subjectUserId: strike.submitter_id,
			refId: strikeId,
			note: null,
			at: now,
		})
		return { result: "undone", keyIds: keys.results.map((k) => k.id).sort((a, b) => a - b) }
	})
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

export async function getStrikeSummary(env: Env, strikeId: number): Promise<StrikeSummary | null> {
	const row = await env.DB.prepare(
		"SELECT kind, key_count, vote_count, repeat, backfill FROM vote_strikes WHERE id = ?"
	)
		.bind(strikeId)
		.first<{
			kind: string
			key_count: number
			vote_count: number
			repeat: boolean
			backfill: boolean
		}>()
	if (!row) return null
	return {
		kind: row.kind,
		keyCount: row.key_count,
		voteCount: row.vote_count,
		repeat: row.repeat,
		backfill: row.backfill,
	}
}
