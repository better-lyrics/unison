import { describe, expect, it } from "vitest"
import { quotaBasisText } from "./council-quota"
import type { BoostQuota } from "./council-types"

const AUGUST = Date.UTC(2026, 7, 1) / 1000
const RESETS = Date.UTC(2026, 9, 1) / 1000

function quota(q: number, basis: Partial<BoostQuota["basis"]>): BoostQuota {
  return {
    quota: q,
    used: 0,
    remaining: q,
    resetsAt: RESETS,
    basis: { active: true, upvotedLyrics: 0, bonus: 0, monthStart: AUGUST, ...basis },
  }
}

describe("quotaBasisText", () => {
  it("splits the base from the earned seals", () => {
    expect(quotaBasisText(quota(8, { upvotedLyrics: 4, bonus: 2 }))).toBe(
      "6 base + 2 earned from 4 upvoted lyrics in August.",
    )
  })

  it("explains the reduced quota after a month without lyrics", () => {
    expect(quotaBasisText(quota(3, { active: false }))).toBe(
      "No lyrics in August, so this month's quota is reduced. Submit lyrics this month to lift next month's.",
    )
  })

  it("names the base when nothing was earned", () => {
    expect(quotaBasisText(quota(6, {}))).toBe("6 base. Your upvoted lyrics this month add seals next month.")
  })

  describe("edge cases", () => {
    it("credits nothing for one upvoted lyric and rounds an odd count down", () => {
      expect(quotaBasisText(quota(6, { upvotedLyrics: 1 }))).toBe(
        "6 base. Your upvoted lyrics this month add seals next month.",
      )
      expect(quotaBasisText(quota(7, { upvotedLyrics: 3, bonus: 1 }))).toBe(
        "6 base + 1 earned from 3 upvoted lyrics in August.",
      )
    })

    it("names the counted month in UTC across a year boundary", () => {
      const december = Date.UTC(2025, 11, 1) / 1000
      expect(quotaBasisText(quota(3, { active: false, monthStart: december }))).toContain("No lyrics in December")
    })

    it("reads the capped quota", () => {
      expect(quotaBasisText(quota(12, { upvotedLyrics: 20, bonus: 6 }))).toBe(
        "6 base + 6 earned from 20 upvoted lyrics in August.",
      )
    })
  })
})
