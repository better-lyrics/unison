import { config } from "@/config"
import { CONSENSUS_LYRICS_CTE, COUNTED_VOTER_PREDICATE } from "@/db/predicates"
import type { Env } from "@/types"

export async function updateReputations(env: Env, userIds?: number[]): Promise<void> {
	if (userIds?.length === 0) return
	const scoped = (column: string) => (userIds ? `AND ${column} = ANY(?::int[])` : "")
	const scope = userIds ? [userIds] : []
	// Deleted lyrics stay in: reputation is historical voting signal.
	await env.DB.prepare(`${CONSENSUS_LYRICS_CTE},
		consensus AS (
			SELECT v.user_id,
				SUM(CASE WHEN v.vote = cl.consensus THEN 1 ELSE -1 END) AS net
			FROM votes v
			JOIN consensus_lyrics cl ON v.lyrics_id = cl.id
			JOIN users u ON u.id = v.user_id
			WHERE v.is_self_vote = 0 AND ${COUNTED_VOTER_PREDICATE} ${scoped("v.user_id")}
			GROUP BY v.user_id
		),
		penalties AS (
			SELECT submitter_id AS user_id, COUNT(*) AS n FROM lyrics
			WHERE reputation_penalized AND submitter_id IS NOT NULL ${scoped("submitter_id")}
			GROUP BY submitter_id
		),
		strikes AS (
			SELECT submitter_id AS user_id, COUNT(*) AS n FROM vote_strikes
			WHERE repeat AND undone_at IS NULL ${scoped("submitter_id")}
			GROUP BY submitter_id
		),
		derived AS (
			SELECT u.id,
				GREATEST(?::DOUBLE PRECISION, LEAST(?::DOUBLE PRECISION,
					?::DOUBLE PRECISION
					+ ?::DOUBLE PRECISION * COALESCE(c.net, 0)
					+ ?::DOUBLE PRECISION * COALESCE(p.n, 0)
					+ ?::DOUBLE PRECISION * COALESCE(s.n, 0))) AS reputation
			FROM users u
			LEFT JOIN consensus c ON c.user_id = u.id
			LEFT JOIN penalties p ON p.user_id = u.id
			LEFT JOIN strikes s ON s.user_id = u.id
			WHERE TRUE ${scoped("u.id")}
		)
		UPDATE users SET reputation = d.reputation
		FROM derived d
		WHERE users.id = d.id AND users.reputation IS DISTINCT FROM d.reputation
	`)
		.bind(
			config.reputation.minVotesForConfidence,
			...scope,
			...scope,
			...scope,
			config.reputation.min,
			config.reputation.max,
			config.reputation.default,
			config.reputation.consensusDelta,
			-config.moderation.autoHide.reputationPenalty,
			-config.voteIntegrity.repeatPenalty.reputation,
			...scope
		)
		.run()
}
