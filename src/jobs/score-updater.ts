import { config } from "@/config"
import { awardConfidenceXp } from "@/db/contribution-events"
import { invalidateCache } from "@/db/lyrics"
import { AUTO_HIDE_PREDICATE } from "@/db/predicates"
import { Logger } from "@/infra/logger"
import type { Confidence, Env } from "@/types"

const log = new Logger("cron")

interface VoteWithUser {
	vote: number
	reputation: number
	avg_vote: number
	is_self_vote: number
}

interface LyricsScoreUpdate {
	id: number
	effective_score: number
	vote_count: number
	diversity_bonus: number
	confidence: Confidence
}

const CONSENSUS_LYRICS_CTE = `WITH consensus_lyrics AS (
	SELECT id, CASE WHEN effective_score > 0 THEN 1 ELSE -1 END AS consensus
	FROM lyrics
	WHERE ABS(effective_score) > 0.5 AND vote_count >= ?
)`

export async function recalculateScore(env: Env, lyricsId: number): Promise<void> {
	const row = await env.DB.prepare(
		"SELECT video_id, deleted_at, submitter_id FROM lyrics WHERE id = ?"
	)
		.bind(lyricsId)
		.first<{ video_id: string; deleted_at: number | null; submitter_id: number | null }>()

	if (!row || row.deleted_at !== null) return

	const votes = await env.DB.prepare(`
		SELECT v.vote, u.reputation, u.avg_vote, v.is_self_vote
		FROM votes v
		JOIN users u ON v.user_id = u.id
		WHERE v.lyrics_id = ?
	`)
		.bind(lyricsId)
		.all<VoteWithUser>()

	const voteRows = votes.results || []
	const update = calculateScore(lyricsId, voteRows)
	const upvotes = voteRows.filter((v) => v.vote === 1).length
	const downvotes = voteRows.filter((v) => v.vote === -1).length

	await env.DB.prepare(`
		UPDATE lyrics SET
			effective_score = ?,
			vote_count = ?,
			upvotes = ?,
			downvotes = ?,
			diversity_bonus = ?,
			confidence = ?,
			score_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
		WHERE id = ?
	`)
		.bind(
			update.effective_score,
			update.vote_count,
			upvotes,
			downvotes,
			update.diversity_bonus,
			update.confidence,
			update.id
		)
		.run()

	await invalidateCache(env, row.video_id)

	if (typeof row.submitter_id === "number") {
		await awardConfidenceXp(env, row.submitter_id, lyricsId, update.confidence)
	}

	log.debug("recalculated score", { lyricsId, effective_score: update.effective_score })
}

export async function updateScores(env: Env): Promise<{ updated: number }> {
	await env.DB.prepare(`
		UPDATE users SET
			avg_vote = COALESCE((SELECT AVG(vote) FROM votes WHERE votes.user_id = users.id), 0),
			vote_count = (SELECT COUNT(*) FROM votes WHERE votes.user_id = users.id)
	`).run()

	await updateReputations(env)

	await awardConsensusVotes(env).catch((err) =>
		log.error("consensus xp failed", { error: (err as Error).message })
	)

	const staleLyrics = await env.DB.prepare(`
		SELECT id AS lyrics_id FROM lyrics
		WHERE score_updated_at IS NULL AND vote_count > 0 AND deleted_at IS NULL
		UNION
		SELECT DISTINCT v.lyrics_id FROM votes v
		JOIN lyrics l ON l.id = v.lyrics_id
		WHERE v.created_at > (EXTRACT(EPOCH FROM NOW())::INTEGER - 21600)
			AND l.deleted_at IS NULL
	`).all<{ lyrics_id: number }>()

	let updated = 0
	for (const { lyrics_id } of staleLyrics.results || []) {
		await recalculateScore(env, lyrics_id)
		updated++
	}

	log.debug("safety-net recalculated stale scores", { count: updated })

	await applyAutoHidePenalty(env)

	return { updated }
}

export async function recomputeAllScores(env: Env): Promise<{ updated: number }> {
	const rows = await env.DB.prepare(
		"SELECT id AS lyrics_id FROM lyrics WHERE deleted_at IS NULL AND vote_count > 0"
	).all<{ lyrics_id: number }>()

	let updated = 0
	for (const { lyrics_id } of rows.results || []) {
		await recalculateScore(env, lyrics_id)
		updated++
	}

	log.info("full score recompute complete", { updated })
	return { updated }
}

async function applyAutoHidePenalty(env: Env): Promise<void> {
	const penalty = config.moderation.autoHide.reputationPenalty
	const minRep = config.reputation.min

	const submitterPenalty = new Map<number, number>()
	const flippedIds: number[] = []

	await env.DB.transaction(async (tx) => {
		const flipped = await tx
			.prepare(
				`UPDATE lyrics SET reputation_penalized = TRUE
				WHERE ${AUTO_HIDE_PREDICATE}
					AND deleted_at IS NULL
					AND reputation_penalized = FALSE
					AND submitter_id IS NOT NULL
				RETURNING id, submitter_id`
			)
			.all<{ id: number; submitter_id: number }>()

		const rows = flipped.results || []
		if (rows.length === 0) return

		for (const r of rows) {
			submitterPenalty.set(
				r.submitter_id,
				(submitterPenalty.get(r.submitter_id) ?? 0) + penalty
			)
			flippedIds.push(r.id)
		}

		for (const [sid, totalPenalty] of submitterPenalty) {
			await tx
				.prepare("UPDATE users SET reputation = GREATEST(?, reputation - ?) WHERE id = ?")
				.bind(minRep, totalPenalty, sid)
				.run()
		}
	})

	if (flippedIds.length === 0) return

	log.info("applied auto-hide reputation penalty", {
		affected_submitters: submitterPenalty.size,
		affected_rows: flippedIds.length,
		lyrics_ids: flippedIds.slice(0, 10),
	})
}

export function calculateScore(lyricsId: number, votes: VoteWithUser[]): LyricsScoreUpdate {
	let weightedSum = 0
	let totalWeight = 0
	let harshUpvotes = 0
	let generousUpvotes = 0

	for (const v of votes) {
		if (v.reputation < config.reputation.voteWeightFloor) continue
		const weight = v.is_self_vote ? v.reputation * config.reputation.selfVoteWeight : v.reputation
		// A zero-weight vote realises to nothing: skip it from score and diversity alike.
		if (weight <= 0) continue

		weightedSum += v.vote * weight
		totalWeight += weight

		// Track clustering for diversity bonus
		if (v.vote > 0) {
			if (v.avg_vote < 0) harshUpvotes++
			else generousUpvotes++
		}
	}

	const effectiveScore = totalWeight > 0 ? weightedSum / totalWeight : 0
	const diversityBonus = harshUpvotes > 0 && generousUpvotes > 0

	// Determine confidence level. A tier above "low" requires both enough votes
	// and a score clearing the floor, so "trusted" never lands on a marginal row.
	// This rule is also reproduced in SQL by backfill-confidence.ts; keep them in sync.
	let confidence: Confidence = "low"
	if (
		votes.length >= config.reputation.minVotesForConfidence &&
		effectiveScore >= config.reputation.minScoreForConfidence
	) {
		confidence = diversityBonus ? "high" : "medium"
	}

	return {
		id: lyricsId,
		effective_score: effectiveScore,
		vote_count: votes.length,
		diversity_bonus: diversityBonus ? 1 : 0,
		confidence,
	}
}

export async function updateReputations(env: Env): Promise<void> {
	// Do NOT add `deleted_at IS NULL` here. Reputation depends on historical
	// voting signal; filtering deleted lyrics destroys it (and reintroduces the
	// cascade-delete problem soft-delete was meant to solve).
	await env.DB.prepare(`${CONSENSUS_LYRICS_CTE},
		deltas AS (
			SELECT v.user_id,
				SUM(CASE WHEN v.vote = cl.consensus THEN ?::DOUBLE PRECISION ELSE ?::DOUBLE PRECISION END) AS delta
			FROM votes v
			JOIN consensus_lyrics cl ON v.lyrics_id = cl.id
			WHERE v.is_self_vote = 0
			GROUP BY v.user_id
		)
		UPDATE users
		SET reputation = GREATEST(?, LEAST(?, reputation + d.delta))
		FROM deltas d
		WHERE users.id = d.user_id
	`)
		.bind(
			config.reputation.minVotesForConfidence,
			config.reputation.consensusDelta,
			-config.reputation.consensusDelta,
			config.reputation.min,
			config.reputation.max
		)
		.run()
}

export async function awardConsensusVotes(env: Env): Promise<void> {
	await env.DB.prepare(`${CONSENSUS_LYRICS_CTE}
		INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id)
		SELECT v.user_id, ?, 'consensus-vote', 'vote', v.id
		FROM votes v
		JOIN consensus_lyrics cl ON v.lyrics_id = cl.id
		WHERE v.vote = cl.consensus AND v.is_self_vote = 0
		ON CONFLICT (user_id, kind, ref_type, ref_id) DO NOTHING`)
		.bind(config.reputation.minVotesForConfidence, config.gamification.xp.weights.consensusVote)
		.run()
}
