import { config } from "@/config"
import type { Confidence, Env } from "@/types"

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

export async function updateScores(env: Env): Promise<{ updated: number }> {
	// 1. Update user avg_vote for clustering
	await env.DB.exec(`
		UPDATE users SET
			avg_vote = COALESCE((SELECT AVG(vote) FROM votes WHERE votes.user_id = users.id), 0),
			vote_count = (SELECT COUNT(*) FROM votes WHERE votes.user_id = users.id)
	`)

	// 2. Get all lyrics with votes that need score updates
	const lyricsWithVotes = await env.DB.prepare(`
		SELECT DISTINCT lyrics_id FROM votes
		WHERE created_at > (unixepoch() - 3600)
		UNION
		SELECT id FROM lyrics WHERE score_updated_at IS NULL AND vote_count > 0
	`).all<{ lyrics_id: number }>()

	const updates: LyricsScoreUpdate[] = []

	for (const { lyrics_id } of lyricsWithVotes.results || []) {
		// Get votes with user data for this lyrics entry
		const votes = await env.DB.prepare(`
			SELECT v.vote, u.reputation, u.avg_vote, v.is_self_vote
			FROM votes v
			JOIN users u ON v.user_id = u.id
			WHERE v.lyrics_id = ?
		`)
			.bind(lyrics_id)
			.all<VoteWithUser>()

		if (!votes.results || votes.results.length === 0) continue

		const update = calculateScore(lyrics_id, votes.results)
		updates.push(update)
	}

	// 3. Batch update lyrics scores
	for (const update of updates) {
		await env.DB.prepare(`
			UPDATE lyrics SET
				effective_score = ?,
				vote_count = ?,
				diversity_bonus = ?,
				confidence = ?,
				score_updated_at = unixepoch()
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
	}

	// 4. Update user reputations based on consensus
	await updateReputations(env)

	return { updated: updates.length }
}

function calculateScore(lyricsId: number, votes: VoteWithUser[]): LyricsScoreUpdate {
	let weightedSum = 0
	let totalWeight = 0
	let harshUpvotes = 0
	let generousUpvotes = 0

	for (const v of votes) {
		// Self-votes count less
		const weight = v.is_self_vote
			? v.reputation * config.reputation.selfVoteWeight
			: v.reputation

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

async function updateReputations(env: Env): Promise<void> {
	// Find lyrics with strong consensus (effective_score > 0.5 or < -0.5)
	const consensusLyrics = await env.DB.prepare(`
		SELECT id, effective_score FROM lyrics
		WHERE ABS(effective_score) > 0.5
		AND vote_count >= ?
	`)
		.bind(config.reputation.minVotesForConfidence)
		.all<{ id: number; effective_score: number }>()

	for (const { id, effective_score } of consensusLyrics.results || []) {
		const consensus = effective_score > 0 ? 1 : -1

		// Get all non-self votes for this lyrics
		const votes = await env.DB.prepare(`
			SELECT user_id, vote FROM votes
			WHERE lyrics_id = ? AND is_self_vote = 0
		`)
			.bind(id)
			.all<{ user_id: number; vote: number }>()

		for (const { user_id, vote } of votes.results || []) {
			const votedWithConsensus = vote === consensus
			const delta = votedWithConsensus
				? config.reputation.consensusDelta
				: -config.reputation.consensusDelta

			await env.DB.prepare(`
				UPDATE users SET reputation = MAX(?, MIN(?, reputation + ?))
				WHERE id = ?
			`)
				.bind(config.reputation.min, config.reputation.max, delta, user_id)
				.run()
		}
	}
}
