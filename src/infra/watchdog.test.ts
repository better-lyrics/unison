import { describe, expect, it } from "vitest"
import { respawnDecision, shouldKill } from "./watchdog"

describe("shouldKill", () => {
	it("does not kill while heartbeats are within the freeze window", () => {
		expect(shouldKill(5_000, 30_000)).toBe(false)
	})

	it("kills once the gap exceeds the freeze window", () => {
		expect(shouldKill(30_001, 30_000)).toBe(true)
	})

	it("does not kill exactly at the threshold", () => {
		expect(shouldKill(30_000, 30_000)).toBe(false)
	})

	describe("edge cases", () => {
		it("is disabled for a zero or negative threshold", () => {
			expect(shouldKill(1_000_000, 0)).toBe(false)
			expect(shouldKill(1_000_000, -1)).toBe(false)
		})

		it("treats a non-finite gap as alive (startup grace, no false positive)", () => {
			expect(shouldKill(Number.NaN, 30_000)).toBe(false)
			expect(shouldKill(Number.POSITIVE_INFINITY, 30_000)).toBe(false)
		})

		it("kills for an arbitrarily long freeze", () => {
			expect(shouldKill(5 * 60 * 60 * 1000, 30_000)).toBe(true)
		})
	})
})

describe("respawnDecision", () => {
	it("respawns and resets the streak when the worker ran past the grace window", () => {
		expect(respawnDecision(60_000, 2)).toEqual({ respawn: true, fastFailures: 0 })
	})

	it("counts a fast exit as a failure and still respawns under the cap", () => {
		expect(respawnDecision(500, 0)).toEqual({ respawn: true, fastFailures: 1 })
		expect(respawnDecision(500, 1)).toEqual({ respawn: true, fastFailures: 2 })
	})

	it("gives up after too many fast failures in a row", () => {
		expect(respawnDecision(500, 2)).toEqual({ respawn: false, fastFailures: 3 })
	})

	it("a healthy long run clears an earlier streak", () => {
		expect(respawnDecision(30_000, 2)).toEqual({ respawn: true, fastFailures: 0 })
	})
})
