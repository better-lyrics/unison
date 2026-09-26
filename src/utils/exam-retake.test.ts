import { describe, expect, it } from "vitest"
import { retakeAvailableAt } from "./exam-retake"

const COOLDOWN = 1000

describe("retakeAvailableAt", () => {
	describe("unlocked outcomes", () => {
		it("unlocks a below-cutoff attempt one cooldown after submission", () => {
			expect(
				retakeAvailableAt({ state: "failed", submittedAt: 50, decidedAt: null }, COOLDOWN)
			).toBe(1050)
		})

		it("unlocks a council-rejected attempt one cooldown after the decision", () => {
			expect(
				retakeAvailableAt({ state: "rejected", submittedAt: 50, decidedAt: 200 }, COOLDOWN)
			).toBe(1200)
		})
	})

	describe("blocked outcomes", () => {
		it.each(["in_progress", "pending_review", "approved"] as const)(
			"never unlocks a retake from %s",
			(state) => {
				expect(retakeAvailableAt({ state, submittedAt: 50, decidedAt: 200 }, COOLDOWN)).toBeNull()
			}
		)
	})

	describe("edge cases", () => {
		it("falls back to submission time for a rejection with no decision time", () => {
			expect(
				retakeAvailableAt({ state: "rejected", submittedAt: 50, decidedAt: null }, COOLDOWN)
			).toBe(1050)
		})

		it("blocks a failed attempt that has no submission time", () => {
			expect(
				retakeAvailableAt({ state: "failed", submittedAt: null, decidedAt: null }, COOLDOWN)
			).toBeNull()
		})

		it("blocks a rejection with neither timestamp", () => {
			expect(
				retakeAvailableAt({ state: "rejected", submittedAt: null, decidedAt: null }, COOLDOWN)
			).toBeNull()
		})

		it("unlocks at the anchor itself when the cooldown is zero", () => {
			expect(retakeAvailableAt({ state: "failed", submittedAt: 50, decidedAt: null }, 0)).toBe(50)
		})
	})

	describe("invariants", () => {
		it("never unlocks a rejection sooner than one cooldown after submission", () => {
			for (const decidedAt of [50, 51, 900]) {
				const at = retakeAvailableAt({ state: "rejected", submittedAt: 50, decidedAt }, COOLDOWN)
				expect(at).toBeGreaterThanOrEqual(50 + COOLDOWN)
			}
		})
	})
})
