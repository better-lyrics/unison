import { describe, expect, it } from "vitest"
import { levelProgress } from "./level"

describe("levelProgress", () => {
  it("computes fraction and remaining below max", () => {
    expect(levelProgress(3200, 4000)).toEqual({ pct: 0.8, remaining: 800, atMax: false })
  })

  it("reports max level when xpForNext is null", () => {
    expect(levelProgress(4000, null)).toEqual({ pct: 1, remaining: 0, atMax: true })
  })

  describe("edge cases", () => {
    it("clamps a fresh account at zero xp", () => {
      expect(levelProgress(0, 50)).toEqual({ pct: 0, remaining: 50, atMax: false })
    })

    it("never exceeds a full ring or negative remaining", () => {
      expect(levelProgress(120, 100)).toEqual({ pct: 1, remaining: 0, atMax: false })
    })

    it("treats a non-positive threshold as max level", () => {
      expect(levelProgress(10, 0)).toEqual({ pct: 1, remaining: 0, atMax: true })
    })
  })

  describe("invariants", () => {
    it("keeps pct within [0, 1] across a range of inputs", () => {
      for (const [xp, next] of [
        [0, 50],
        [49, 50],
        [200, 350],
        [999, 1000],
      ] as const) {
        const { pct } = levelProgress(xp, next)
        expect(pct).toBeGreaterThanOrEqual(0)
        expect(pct).toBeLessThanOrEqual(1)
      }
    })
  })
})
