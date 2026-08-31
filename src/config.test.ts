import { config } from "@/config"
import { describe, expect, it } from "vitest"

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

describe("config.thresholdAudit", () => {
	it("is disabled-safe and carries a daily schedule and tolerance", () => {
		expect(typeof config.thresholdAudit.enabled).toBe("boolean")
		expect(config.thresholdAudit.schedule).toBe("0 9 * * *")
		expect(config.thresholdAudit.driftTolerance).toBe(0.1)
	})

	it("defines target/floor/ceil for every audited threshold", () => {
		const t = config.thresholdAudit.targets
		expect(t.minVotesForConfidence).toEqual({ targetFraction: 0.25, floor: 2, ceil: 10 })
		expect(t.primarySlotMinVotes).toEqual({ targetFraction: 0.2, floor: 2, ceil: 10 })
		expect(t.autoHideMinVotes).toEqual({ targetFraction: 0.15, floor: 2, ceil: 10 })
		expect(t.autoHideDecisiveMinVotes).toEqual({ targetFraction: 0.5, floor: 2, ceil: 10 })
		expect(t.reportsThreshold).toEqual({ targetFraction: 0.15, floor: 2, ceil: 10 })
	})
})

describe("config.translation", () => {
	it("carries a browser User-Agent for the lyrics_translate upstream", () => {
		expect(config.translation.userAgent).toContain("Mozilla/5.0")
		expect(config.translation.userAgent).toContain("Chrome/")
	})
})
