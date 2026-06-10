import { describe, expect, it } from "vitest"
import { config } from "@/config"

describe("config additions for abuse mitigation", () => {
	it("exposes autoHide.reputationPenalty", () => {
		expect(config.moderation.autoHide.reputationPenalty).toBe(0.2)
	})

	it("exposes reputation.voteWeightFloor", () => {
		expect(config.reputation.voteWeightFloor).toBe(0.5)
	})

	it("exposes ranking.primarySlot floor and minVotes", () => {
		expect(config.ranking.primarySlot.repFloor).toBe(1.0)
		expect(config.ranking.primarySlot.minVotes).toBe(3)
	})
})
