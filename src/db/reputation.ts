import { config } from "@/config"
import { CONSENSUS_LYRICS_CTE, COUNTED_VOTER_PREDICATE } from "@/db/predicates"
import type { Env } from "@/types"

export async function updateReputations(env: Env, userIds?: number[]): Promise<void> {
	if (userIds?.length === 0) return
	const scope = userIds ? `WHERE u.id IN (${userIds.map(() => "?").join(", ")})` : ""
	// Do NOT add `deleted_at IS NULL` here. Reputation depends on historical
	// voting signal; filtering deleted lyrics destroys it.
	await env.DB.prepare(`${CONSENSUS_LYRICS_CTE},
		consensus AS (
			SELECT v.user_id,
				SUM(CASE WHEN v.vote = cl.consensus THEN 1 ELSE -1 END) AS net
			FROM votes v
			JOIN consensus_lyrics cl ON v.lyrics_id = cl.id
			JOIN users u ON u.id = v.user_id
			WHERE v.is_self_vote = 0 AND ${COUNTED_VOTER_PREDICATE}
			GROUP BY v.user_id
		),
		penalties AS (
			SELECT user_id, COUNT(*) AS n FROM contribution_events
			WHERE kind = 'penalized'
			GROUP BY user_id
		),
		strikes AS (
			SELECT submitter_id AS user_id, COUNT(*) AS n FROM vote_strikes
			WHERE repeat AND undone_at IS NULL
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
			${scope}
		)
		UPDATE users SET reputation = d.reputation
		FROM derived d
		WHERE users.id = d.id AND users.reputation IS DISTINCT FROM d.reputation
	`)
		.bind(
			config.reputation.minVotesForConfidence,
			config.reputation.min,
			config.reputation.max,
			config.reputation.default,
			config.reputation.consensusDelta,
			-config.moderation.autoHide.reputationPenalty,
			-config.voteIntegrity.repeatPenalty.reputation,
			...(userIds ?? [])
		)
		.run()
}
