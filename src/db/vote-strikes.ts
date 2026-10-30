import { COMMUNITY_KEY_ID, config } from "@/config"
import type { Env } from "@/types"

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
