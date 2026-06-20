import {
	type Histogram,
	checkDrift,
	coverageAtLeast,
	deriveThreshold,
} from "@/utils/threshold-derive"
import { describe, expect, it } from "vitest"

// Real shape from issue #41: 571 positive incumbents, median vote_count 1,
// p90 3, p95 6, ~3% reach 10. Encoded as an at-least histogram.
const INCUMBENTS: Histogram = {
	total: 571,
	atLeast: { 1: 571, 2: 200, 3: 57, 4: 40, 5: 34, 6: 29, 7: 22, 8: 20, 9: 18, 10: 17 },
}

describe("coverageAtLeast", () => {
	it("returns the fraction of the population at or above the threshold", () => {
		expect(coverageAtLeast(INCUMBENTS, 3)).toBeCloseTo(57 / 571, 5)
	})

	it("returns 0 for an empty population", () => {
		expect(coverageAtLeast({ total: 0, atLeast: {} }, 2)).toBe(0)
	})

	it("treats an unknown threshold key as zero coverage", () => {
		expect(coverageAtLeast(INCUMBENTS, 99)).toBe(0)
	})
})

describe("deriveThreshold", () => {
	it("picks the smallest integer whose coverage is at or below the target", () => {
		// ~25% target: coverage at 2 is 200/571 (0.35) > 0.25, at 3 is 0.10 <= 0.25 -> 3
		expect(deriveThreshold(INCUMBENTS, 0.25, { floor: 2, ceil: 10 })).toBe(3)
	})

	it("never returns below the floor even when the floor already satisfies the target", () => {
		expect(deriveThreshold(INCUMBENTS, 0.9, { floor: 2, ceil: 10 })).toBe(2)
	})

	it("clamps to the ceil when no threshold in range meets the target", () => {
		expect(deriveThreshold(INCUMBENTS, 0.001, { floor: 2, ceil: 10 })).toBe(10)
	})

	it("returns the floor for an empty population", () => {
		expect(deriveThreshold({ total: 0, atLeast: {} }, 0.25, { floor: 2, ceil: 10 })).toBe(2)
	})
})

describe("invariants", () => {
	it("is monotonic: a smaller target fraction yields a non-decreasing threshold", () => {
		const loose = deriveThreshold(INCUMBENTS, 0.4, { floor: 2, ceil: 10 })
		const strict = deriveThreshold(INCUMBENTS, 0.05, { floor: 2, ceil: 10 })
		expect(strict).toBeGreaterThanOrEqual(loose)
	})
})

describe("checkDrift", () => {
	it("flags drift when the recommendation differs and coverage is outside the tolerance band", () => {
		const r = checkDrift({
			name: "minVotesForConfidence",
			hist: INCUMBENTS,
			current: 5,
			targetFraction: 0.25,
			floor: 2,
			ceil: 10,
			tolerance: 0.1,
		})
		expect(r.recommended).toBe(3)
		expect(r.drifted).toBe(true)
	})

	it("stays quiet when the recommendation differs but coverage is within tolerance", () => {
		const r = checkDrift({
			name: "x",
			hist: INCUMBENTS,
			current: 3,
			targetFraction: 0.12,
			floor: 2,
			ceil: 10,
			tolerance: 0.1,
		})
		expect(r.drifted).toBe(false)
	})

	it("stays quiet when the recommendation equals the current value", () => {
		const r = checkDrift({
			name: "x",
			hist: INCUMBENTS,
			current: 3,
			targetFraction: 0.25,
			floor: 2,
			ceil: 10,
			tolerance: 0.1,
		})
		expect(r.recommended).toBe(3)
		expect(r.drifted).toBe(false)
	})
})
