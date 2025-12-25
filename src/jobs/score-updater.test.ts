import { describe, expect, it } from "vitest"
import { config } from "@/config"
import type { Confidence } from "@/types"

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

// Extract the calculateScore logic for testing
function calculateScore(lyricsId: number, votes: VoteWithUser[]): LyricsScoreUpdate {
	let weightedSum = 0
	let totalWeight = 0
	let harshUpvotes = 0
	let generousUpvotes = 0

	for (const v of votes) {
		const weight = v.is_self_vote
			? v.reputation * config.reputation.selfVoteWeight
			: v.reputation

		weightedSum += v.vote * weight
		totalWeight += weight

		if (v.vote > 0) {
			if (v.avg_vote < 0) harshUpvotes++
			else generousUpvotes++
		}
	}

	const effectiveScore = totalWeight > 0 ? weightedSum / totalWeight : 0
	const diversityBonus = harshUpvotes > 0 && generousUpvotes > 0

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

describe("calculateScore", () => {
	it("returns correct weighted score for equal reputation votes", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(0.333, 2)
		expect(result.vote_count).toBe(3)
	})

	it("weights votes by user reputation", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 }, // High rep upvote
			{ vote: -1, reputation: 0.5, avg_vote: 0.3, is_self_vote: 0 }, // Low rep downvote
		]

		const result = calculateScore(1, votes)

		// (1 * 2.0 + -1 * 0.5) / (2.0 + 0.5) = 1.5 / 2.5 = 0.6
		expect(result.effective_score).toBeCloseTo(0.6, 2)
	})

	it("reduces self-vote weight by half", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 1 }, // Self-vote
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 }, // Normal vote
		]

		const result = calculateScore(1, votes)

		// (1 * 0.5 + 1 * 1.0) / (0.5 + 1.0) = 1.5 / 1.5 = 1.0
		expect(result.effective_score).toBe(1)
	})

	it("detects diversity bonus when both harsh and generous raters upvote", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 }, // Harsh rater (avg_vote < 0)
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 }, // Generous rater (avg_vote >= 0)
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(1)
	})

	it("no diversity bonus when only one type of rater upvotes", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 }, // Harsh rater but downvoted
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(0)
	})

	it("returns low confidence for fewer than 5 votes", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("low")
	})

	it("returns medium confidence for 5+ votes without diversity", () => {
		const votes: VoteWithUser[] = Array.from({ length: 5 }, () => ({
			vote: 1,
			reputation: 1.0,
			avg_vote: 0.5,
			is_self_vote: 0,
		}))

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("medium")
	})

	it("returns high confidence for 5+ votes with diversity", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 }, // Harsh
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 }, // Generous
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.2, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: -0.1, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("high")
	})

	it("handles empty votes array", () => {
		const result = calculateScore(1, [])

		expect(result.effective_score).toBe(0)
		expect(result.vote_count).toBe(0)
		expect(result.confidence).toBe("low")
	})

	it("handles all downvotes", () => {
		const votes: VoteWithUser[] = [
			{ vote: -1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBe(-1)
		expect(result.diversity_bonus).toBe(0) // No upvotes = no diversity check applies
	})

	it("handles mixed high and low reputation users", () => {
		const votes: VoteWithUser[] = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 }, // Max rep
			{ vote: -1, reputation: 0.0, avg_vote: -0.5, is_self_vote: 0 }, // Min rep (no weight)
		]

		const result = calculateScore(1, votes)

		// Only the upvote counts since downvote has 0 reputation
		expect(result.effective_score).toBe(1)
	})
})

describe("reputation bounds", () => {
	it("config has correct reputation bounds", () => {
		expect(config.reputation.min).toBe(0.0)
		expect(config.reputation.max).toBe(2.0)
		expect(config.reputation.default).toBe(1.0)
	})

	it("config has correct self-vote weight", () => {
		expect(config.reputation.selfVoteWeight).toBe(0.5)
	})

	it("config has correct minimum votes for confidence", () => {
		expect(config.reputation.minVotesForConfidence).toBe(5)
	})

	it("config has correct consensus delta", () => {
		expect(config.reputation.consensusDelta).toBe(0.1)
	})
})
