import { describe, expect, it } from "vitest"
import { canStartNewAttempt, retakeAvailableAt } from "./exam-retake"

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

describe("canStartNewAttempt", () => {
	it("admits an account that has never sat the exam", () => {
		expect(canStartNewAttempt(null, COOLDOWN, 0)).toBe(true)
	})

	it("admits a failed attempt once the cooldown has passed", () => {
		expect(
			canStartNewAttempt({ state: "failed", submittedAt: 50, decidedAt: null }, COOLDOWN, 1050)
		).toBe(true)
	})

	describe("edge cases", () => {
		it("refuses one second before the retake time", () => {
			expect(
				canStartNewAttempt({ state: "failed", submittedAt: 50, decidedAt: null }, COOLDOWN, 1049)
			).toBe(false)
		})

		it("refuses an attempt that is still in progress", () => {
			expect(
				canStartNewAttempt(
					{ state: "in_progress", submittedAt: null, decidedAt: null },
					COOLDOWN,
					10_000
				)
			).toBe(false)
		})

		it.each(["pending_review", "approved"] as const)(
			"refuses %s however much time has passed",
			(state) => {
				expect(canStartNewAttempt({ state, submittedAt: 1, decidedAt: 2 }, COOLDOWN, 10_000)).toBe(
					false
				)
			}
		)
	})

	describe("invariants", () => {
		it("agrees with retakeAvailableAt for every graded outcome", () => {
			for (const state of ["failed", "rejected", "pending_review", "approved"] as const) {
				const attempt = { state, submittedAt: 50, decidedAt: 200 }
				const at = retakeAvailableAt(attempt, COOLDOWN)
				for (const now of [0, 1199, 1200, 5000]) {
					expect(canStartNewAttempt(attempt, COOLDOWN, now)).toBe(at !== null && now >= at)
				}
			}
		})
	})
})
