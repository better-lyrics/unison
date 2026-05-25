import { config } from "@/config"
import { invalidateCache } from "@/db/lyrics"
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

export async function recalculateScore(env: Env, lyricsId: number): Promise<void> {
	const row = await env.DB.prepare("SELECT video_id, deleted_at FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ video_id: string; deleted_at: number | null }>()

	if (!row || row.deleted_at !== null) return

	const votes = await env.DB.prepare(`
		SELECT v.vote, u.reputation, u.avg_vote, v.is_self_vote
		FROM votes v
		JOIN users u ON v.user_id = u.id
		WHERE v.lyrics_id = ?
	`)
		.bind(lyricsId)
		.all<VoteWithUser>()

	const update = calculateScore(lyricsId, votes.results || [])

	await env.DB.prepare(`
		UPDATE lyrics SET
			effective_score = ?,
			vote_count = ?,
			diversity_bonus = ?,
			confidence = ?,
			score_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
		WHERE id = ?
	`)
		.bind(
			update.effective_score,
			update.vote_count,
			update.diversity_bonus,
			update.confidence,
			update.id
		)
		.run()

	await invalidateCache(env, row.video_id)

	log.debug("recalculated score", { lyricsId, effective_score: update.effective_score })
}

export async function updateScores(env: Env): Promise<{ updated: number }> {
	// 1. Update user avg_vote for clustering
	await env.DB.prepare(`
		UPDATE users SET
			avg_vote = COALESCE((SELECT AVG(vote) FROM votes WHERE votes.user_id = users.id), 0),
			vote_count = (SELECT COUNT(*) FROM votes WHERE votes.user_id = users.id)
	`).run()

	// 2. Update user reputations based on consensus
	await updateReputations(env)

	// 3. Safety net: recalculate entries that were never scored or voted on recently
	//    (catches fire-and-forget recalculateScore failures from votes/reports)
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

	return { updated }
}

export function calculateScore(lyricsId: number, votes: VoteWithUser[]): LyricsScoreUpdate {
	let weightedSum = 0
	let totalWeight = 0
	let harshUpvotes = 0
	let generousUpvotes = 0

	for (const v of votes) {
		// Self-votes count less
		const weight = v.is_self_vote ? v.reputation * config.reputation.selfVoteWeight : v.reputation

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

	// Determine confidence level
	let confidence: Confidence = "low"
	if (votes.length >= config.reputation.minVotesForConfidence) {
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
	await env.DB.prepare(`
		WITH consensus_lyrics AS (
			SELECT id, CASE WHEN effective_score > 0 THEN 1 ELSE -1 END AS consensus
			FROM lyrics
			WHERE ABS(effective_score) > 0.5 AND vote_count >= ?
		),
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
