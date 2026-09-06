import { describe, expect, it } from "vitest"
import { type TierName, tierForRank } from "./tiers"

const cfg = {
	podium: ["legendary", "grandmaster", "master"] as const,
	elite: { topPercent: 5 },
	lyricist: { topPercent: 20 },
}

describe("tierForRank", () => {
	it("assigns podium ranks 1-3", () => {
		expect(tierForRank(1, 1000, cfg)).toBe<TierName>("legendary")
		expect(tierForRank(2, 1000, cfg)).toBe("grandmaster")
		expect(tierForRank(3, 1000, cfg)).toBe("master")
	})
	it("assigns elite inside top 5% and lyricist inside top 20%", () => {
		expect(tierForRank(40, 1000, cfg)).toBe("elite")
		expect(tierForRank(150, 1000, cfg)).toBe("lyricist")
	})
	it("returns null below the base band", () => {
		expect(tierForRank(500, 1000, cfg)).toBeNull()
	})
	it("edge cases: tiny leaderboards do not crash", () => {
		expect(tierForRank(1, 1, cfg)).toBe("legendary")
		expect(tierForRank(1, 0, cfg)).toBe("legendary")
	})
	it("pins the exact band boundaries", () => {
		expect(tierForRank(50, 1000, cfg)).toBe("elite")
		expect(tierForRank(51, 1000, cfg)).toBe("lyricist")
		expect(tierForRank(200, 1000, cfg)).toBe("lyricist")
		expect(tierForRank(201, 1000, cfg)).toBeNull()
	})
})
