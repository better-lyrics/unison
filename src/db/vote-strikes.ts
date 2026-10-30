import { COMMUNITY_KEY_ID, config } from "@/config"
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
		WHERE u.votes_discounted_at IS NULL AND (r.user_id IS NOT NULL OR d.n >= ?)
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
