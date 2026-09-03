import { describe, expect, it } from "vitest"
import { quotaForTier } from "./boost-quota"

const cfg = { quotaBase: 2, quotaPerTier: 2 }

describe("quotaForTier", () => {
	it("scales up the ladder", () => {
		expect(quotaForTier("lyricist", cfg)).toBe(2)
		expect(quotaForTier("elite", cfg)).toBe(4)
		expect(quotaForTier("master", cfg)).toBe(6)
		expect(quotaForTier("grandmaster", cfg)).toBe(8)
		expect(quotaForTier("legendary", cfg)).toBe(10)
	})
	it("untiered committee members get the base", () => {
		expect(quotaForTier(null, cfg)).toBe(2)
	})
	it("separates the base from the per-tier increment", () => {
		const cfg2 = { quotaBase: 3, quotaPerTier: 2 }
		expect(quotaForTier(null, cfg2)).toBe(3)
		expect(quotaForTier("lyricist", cfg2)).toBe(3)
		expect(quotaForTier("elite", cfg2)).toBe(5)
		expect(quotaForTier("master", cfg2)).toBe(7)
		expect(quotaForTier("grandmaster", cfg2)).toBe(9)
		expect(quotaForTier("legendary", cfg2)).toBe(11)
	})
})
