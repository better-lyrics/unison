import { describe, expect, it } from "vitest"
import { levelProgress } from "./level"

describe("levelProgress", () => {
  it("fills the ring by progress within the current band, not total xp", () => {
    const p = levelProgress(3200, 4000, 2800)
    expect(p.pct).toBeCloseTo(400 / 1200, 10)
    expect(p.remaining).toBe(800)
    expect(p.atMax).toBe(false)
  })

  it("reports max level when xpForNext is null", () => {
    expect(levelProgress(4000, null, 2800)).toEqual({ pct: 1, remaining: 0, atMax: true })
  })

  describe("edge cases", () => {
    it("empties the ring at the start of a fresh band", () => {
      expect(levelProgress(2800, 4000, 2800)).toEqual({ pct: 0, remaining: 1200, atMax: false })
    })

    it("clamps a fresh account at zero xp", () => {
      expect(levelProgress(0, 50, 0)).toEqual({ pct: 0, remaining: 50, atMax: false })
    })

    it("never exceeds a full ring or negative remaining", () => {
      expect(levelProgress(120, 100, 0)).toEqual({ pct: 1, remaining: 0, atMax: false })
    })

    it("treats a next threshold at or below the floor as max level", () => {
      expect(levelProgress(10, 0, 0)).toEqual({ pct: 1, remaining: 0, atMax: true })
    })

    it("defaults the floor to zero when omitted", () => {
      const p = levelProgress(200, 350)
      expect(p.pct).toBeCloseTo(200 / 350, 10)
    })
  })

  describe("regressions", () => {
    it("regression: a just-levelled account does not show a near-full ring", () => {
      // xp=2800 sits at the floor of level 8; the ring must read ~0%, not 2800/4000=70%.
      expect(levelProgress(2800, 4000, 2800).pct).toBe(0)
    })
  })

  describe("invariants", () => {
    it("keeps pct within [0, 1] across a range of inputs", () => {
      for (const [xp, next, floor] of [
        [0, 50, 0],
        [49, 50, 0],
        [200, 350, 150],
        [999, 1000, 700],
        [3200, 4000, 2800],
      ] as const) {
        const { pct } = levelProgress(xp, next, floor)
        expect(pct).toBeGreaterThanOrEqual(0)
        expect(pct).toBeLessThanOrEqual(1)
      }
    })
  })
})
