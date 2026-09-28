import { describe, expect, it } from "vitest"
import { quotaBasisText, quotaExplanation, quotaRuleText } from "./council-quota"
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
    rule: { base: 6, inactive: 3, max: 12, upvotedLyricsPerSeal: 2 },
  }
}

const RULE =
  "Each month: 6 seals if you submitted lyrics the month before, 3 if not, plus 1 for every 2 of those lyrics that got upvoted, up to 12. New members get 6 for their first two months."

describe("quotaBasisText", () => {
  it("splits the base from the earned seals", () => {
    expect(quotaBasisText(quota(8, { upvotedLyrics: 4, bonus: 2 }))).toBe(
      "6 base + 2 earned from 4 upvoted lyrics in August.",
    )
  })

  it("explains the reduced quota after a month without lyrics", () => {
    expect(quotaBasisText(quota(3, { active: false }))).toBe(
      "None of your August lyrics count, so this month's quota is reduced. Submit lyrics this month to lift next month's.",
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
      expect(quotaBasisText(quota(3, { active: false, monthStart: december }))).toContain(
        "None of your December lyrics count",
      )
    })

    it("reads the capped quota", () => {
      expect(quotaBasisText(quota(12, { upvotedLyrics: 20, bonus: 6 }))).toBe(
        "6 base + 6 earned from 20 upvoted lyrics in August.",
      )
    })
  })
})

describe("quotaBasisText for another member", () => {
  it("speaks about the member instead of you", () => {
    expect(quotaBasisText(quota(3, { active: false }), "member")).toBe(
      "None of their August lyrics count, so this month's quota is reduced.",
    )
    expect(quotaBasisText(quota(6, {}), "member")).toBe("6 base, nothing earned from August.")
  })

  it("reads the earned split the same way", () => {
    expect(quotaBasisText(quota(8, { upvotedLyrics: 4, bonus: 2 }), "member")).toBe(
      "6 base + 2 earned from 4 upvoted lyrics in August.",
    )
  })
})

describe("quotaRuleText", () => {
  it("states the whole rule from the numbers the server sent", () => {
    expect(quotaRuleText(quota(6, {}))).toBe(RULE)
  })

  describe("edge cases", () => {
    it("follows a changed rule instead of fixed numbers", () => {
      const changed = { ...quota(5, {}), rule: { base: 5, inactive: 2, max: 9, upvotedLyricsPerSeal: 3 } }
      expect(quotaRuleText(changed)).toBe(
        "Each month: 5 seals if you submitted lyrics the month before, 2 if not, plus 1 for every 3 of those lyrics that got upvoted, up to 9. New members get 5 for their first two months.",
      )
    })

    it("says every upvoted lyric when one earns a seal", () => {
      const one = { ...quota(6, {}), rule: { base: 6, inactive: 3, max: 12, upvotedLyricsPerSeal: 1 } }
      expect(quotaRuleText(one)).toContain("plus 1 for every lyric that got upvoted")
    })
  })
})

describe("quotaExplanation", () => {
  it("puts the member's own split before the rule", () => {
    expect(quotaExplanation(quota(8, { upvotedLyrics: 4, bonus: 2 }))).toBe(
      `6 base + 2 earned from 4 upvoted lyrics in August. ${RULE}`,
    )
  })

  it("passes the subject through", () => {
    expect(quotaExplanation(quota(3, { active: false }), "member")).toBe(
      `None of their August lyrics count, so this month's quota is reduced. ${RULE}`,
    )
  })
})
