import { describe, expect, it } from "vitest"
import { config } from "@/config"
import { calculateScore } from "@/jobs/score-updater"

describe("calculateScore", () => {
	it("returns correct weighted score for equal reputation votes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBeCloseTo(0.333, 2)
		expect(result.vote_count).toBe(3)
	})

	it("weights votes by user reputation", () => {
		const votes = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.5, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		// (1 * 2.0 + -1 * 0.5) / (2.0 + 0.5) = 1.5 / 2.5 = 0.6
		expect(result.effective_score).toBeCloseTo(0.6, 2)
	})

	it("reduces self-vote weight by half", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 1 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		// (1 * 0.5 + 1 * 1.0) / (0.5 + 1.0) = 1.5 / 1.5 = 1.0
		expect(result.effective_score).toBe(1)
	})

	it("detects diversity bonus when both harsh and generous raters upvote", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(1)
	})

	it("no diversity bonus when only one type of rater upvotes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.3, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.diversity_bonus).toBe(0)
	})

	it("returns low confidence for fewer than 5 votes", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("low")
	})

	it("returns medium confidence for 5+ votes without diversity", () => {
		const votes = Array.from({ length: 5 }, () => ({
			vote: 1,
			reputation: 1.0,
			avg_vote: 0.5,
			is_self_vote: 0,
		}))

		const result = calculateScore(1, votes)

		expect(result.confidence).toBe("medium")
	})

	it("returns high confidence for 5+ votes with diversity", () => {
		const votes = [
			{ vote: 1, reputation: 1.0, avg_vote: -0.5, is_self_vote: 0 },
			{ vote: 1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
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
		const votes = [
			{ vote: -1, reputation: 1.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 1.0, avg_vote: -0.2, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

		expect(result.effective_score).toBe(-1)
		expect(result.diversity_bonus).toBe(0)
	})

	it("handles mixed high and low reputation users", () => {
		const votes = [
			{ vote: 1, reputation: 2.0, avg_vote: 0.5, is_self_vote: 0 },
			{ vote: -1, reputation: 0.0, avg_vote: -0.5, is_self_vote: 0 },
		]

		const result = calculateScore(1, votes)

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
