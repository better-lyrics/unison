import { describe, expect, it } from "vitest"
import { decideOutcome } from "./revision-gate"

const clean = { sealed: false, jevFlagged: false, textDrift: 0, timingDrift: 0, patch: false }

describe("decideOutcome", () => {
	it("goes live for a small edit", () => {
		expect(decideOutcome(clean)).toEqual({ goesLive: true, reason: null })
	})

	it("holds a sealed lyric for review", () => {
		expect(decideOutcome({ ...clean, sealed: true })).toEqual({ goesLive: false, reason: "sealed" })
	})

	it("holds a flagged edit for review", () => {
		expect(decideOutcome({ ...clean, jevFlagged: true })).toEqual({
			goesLive: false,
			reason: "flagged",
		})
	})

	it("holds a large text change", () => {
		expect(decideOutcome({ ...clean, textDrift: 0.16 }).reason).toBe("large_text_drift")
	})

	it("holds a large timing change", () => {
		expect(decideOutcome({ ...clean, timingDrift: 0.31 }).reason).toBe("large_timing_drift")
	})

	describe("patches", () => {
		it("holds a patch that clears every gate as suggested", () => {
			expect(decideOutcome({ ...clean, patch: true })).toEqual({
				goesLive: false,
				reason: "suggested",
			})
		})

		it("lets seal, drift and flag win over suggested", () => {
			const patch = { ...clean, patch: true }
			expect(decideOutcome({ ...patch, sealed: true }).reason).toBe("sealed")
			expect(decideOutcome({ ...patch, textDrift: 0.16 }).reason).toBe("large_text_drift")
			expect(decideOutcome({ ...patch, timingDrift: 0.31 }).reason).toBe("large_timing_drift")
			expect(decideOutcome({ ...patch, jevFlagged: true }).reason).toBe("flagged")
		})
	})

	describe("edge cases", () => {
		it("lets an edit exactly at each limit go live", () => {
			expect(decideOutcome({ ...clean, textDrift: 0.15, timingDrift: 0.3 }).goesLive).toBe(true)
		})
	})

	describe("invariants", () => {
		it("applies the first matching rule: sealed, text, timing, flagged", () => {
			const all = { sealed: true, jevFlagged: true, textDrift: 1, timingDrift: 1, patch: false }
			expect(decideOutcome(all).reason).toBe("sealed")
			expect(decideOutcome({ ...all, sealed: false }).reason).toBe("large_text_drift")
			expect(decideOutcome({ ...all, sealed: false, textDrift: 0 }).reason).toBe(
				"large_timing_drift"
			)
			expect(decideOutcome({ ...all, sealed: false, textDrift: 0, timingDrift: 0 }).reason).toBe(
				"flagged"
			)
		})

		it("never returns a reason for a live outcome", () => {
			const outcome = decideOutcome(clean)
			expect(outcome.goesLive && outcome.reason === null).toBe(true)
		})
	})
})
