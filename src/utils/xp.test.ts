import { describe, expect, it } from "vitest"
import { levelForXp } from "./xp"

const thresholds = [0, 50, 150, 350]

describe("levelForXp", () => {
	it("level 1 at 0 xp, next at 50", () => {
		expect(levelForXp(0, thresholds)).toEqual({ level: 1, xpForNext: 50, xpFloor: 0 })
	})
	it("crosses thresholds", () => {
		expect(levelForXp(50, thresholds)).toEqual({ level: 2, xpForNext: 150, xpFloor: 50 })
		expect(levelForXp(149, thresholds)).toEqual({ level: 2, xpForNext: 150, xpFloor: 50 })
		expect(levelForXp(150, thresholds)).toEqual({ level: 3, xpForNext: 350, xpFloor: 150 })
	})
	it("caps at the top level with null next", () => {
		expect(levelForXp(9999, thresholds)).toEqual({ level: 4, xpForNext: null, xpFloor: 350 })
	})
	it("negative xp clamps to level 1", () => {
		expect(levelForXp(-100, thresholds)).toEqual({ level: 1, xpForNext: 50, xpFloor: 0 })
	})
	it("edge cases: top threshold and empty input", () => {
		expect(levelForXp(350, thresholds)).toEqual({ level: 4, xpForNext: null, xpFloor: 350 })
		expect(levelForXp(50, [])).toEqual({ level: 1, xpForNext: null, xpFloor: 0 })
	})

	describe("xpFloor", () => {
		it("is the entry threshold of the current level band", () => {
			expect(levelForXp(200, thresholds).xpFloor).toBe(150)
			expect(levelForXp(349, thresholds).xpFloor).toBe(150)
		})
		it("invariant: xpFloor <= xp and, below max, xp < xpForNext", () => {
			for (const xp of [0, 49, 50, 200, 349]) {
				const { xpForNext, xpFloor } = levelForXp(xp, thresholds)
				expect(xpFloor).toBeLessThanOrEqual(xp)
				if (xpForNext !== null) expect(xp).toBeLessThan(xpForNext)
			}
		})
	})
})
