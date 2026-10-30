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

describe("voteIntegrity", () => {
	const v = config.voteIntegrity

	it("keeps devotedShare above half so a key maps to at most one submitter", () => {
		expect(v.devotedShare).toBeGreaterThan(0.5)
		expect(v.devotedShare).toBeLessThanOrEqual(1)
	})

	it("needs more than one key for a ring and more than one vote for a serial key", () => {
		expect(v.ring.minKeys).toBeGreaterThan(1)
		expect(v.serialMinVotes).toBeGreaterThan(1)
	})

	it("gives a serial key a positive window to fit its votes in", () => {
		expect(v.serialWindowSec).toBeGreaterThan(0)
	})

	it("only ever lowers a ranking with the strike multipliers", () => {
		expect(v.multiplier.one).toBeLessThan(1)
		expect(v.multiplier.many).toBeLessThan(v.multiplier.one)
		expect(v.multiplier.many).toBeGreaterThan(0)
	})

	it("penalises a repeat strike", () => {
		expect(v.repeatPenalty.reputation).toBeGreaterThan(0)
		expect(v.repeatPenalty.xp).toBeLessThan(0)
	})
})
