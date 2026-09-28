import { describe, expect, it } from "vitest"
import { quotaForBasis } from "./boost-quota"

const cfg = { base: 6, inactive: 3, max: 12, upvotedLyricsPerSeal: 2 }

describe("quotaForBasis", () => {
	it("gives an active member the base with no upvoted lyrics", () => {
		expect(quotaForBasis({ active: true, upvotedLyrics: 0 }, cfg)).toEqual({ quota: 6, bonus: 0 })
	})

	it("adds one seal per two upvoted lyrics", () => {
		expect(quotaForBasis({ active: true, upvotedLyrics: 2 }, cfg)).toEqual({ quota: 7, bonus: 1 })
		expect(quotaForBasis({ active: true, upvotedLyrics: 9 }, cfg)).toEqual({ quota: 10, bonus: 4 })
	})

	it("drops an inactive member to the inactive quota", () => {
		expect(quotaForBasis({ active: false, upvotedLyrics: 0 }, cfg)).toEqual({ quota: 3, bonus: 0 })
	})

	describe("edge cases", () => {
		it("rounds an odd upvoted lyric down", () => {
			expect(quotaForBasis({ active: true, upvotedLyrics: 1 }, cfg)).toEqual({ quota: 6, bonus: 0 })
			expect(quotaForBasis({ active: true, upvotedLyrics: 3 }, cfg)).toEqual({ quota: 7, bonus: 1 })
		})

		it("caps the quota at max", () => {
			expect(quotaForBasis({ active: true, upvotedLyrics: 12 }, cfg)).toEqual({
				quota: 12,
				bonus: 6,
			})
			expect(quotaForBasis({ active: true, upvotedLyrics: 500 }, cfg)).toEqual({
				quota: 12,
				bonus: 6,
			})
		})

		it("ignores upvoted lyrics when inactive", () => {
			expect(quotaForBasis({ active: false, upvotedLyrics: 8 }, cfg)).toEqual({
				quota: 3,
				bonus: 0,
			})
		})
	})

	describe("invariants", () => {
		it("never goes below inactive or above max, and never shrinks with more upvoted lyrics", () => {
			let previous = 0
			for (let n = 0; n <= 40; n++) {
				const { quota, bonus } = quotaForBasis({ active: true, upvotedLyrics: n }, cfg)
				expect(quota).toBeGreaterThanOrEqual(cfg.inactive)
				expect(quota).toBeLessThanOrEqual(cfg.max)
				expect(quota).toBeGreaterThanOrEqual(previous)
				expect(quota).toBe(cfg.base + bonus)
				previous = quota
			}
		})
	})
})
