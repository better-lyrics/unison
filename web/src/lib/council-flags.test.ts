import { NOW, OLA, flagItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { flagConflict, reportGroups } from "./council-flags"
import type { FlagReport } from "./council-types"

const report = (overrides: Partial<FlagReport> = {}): FlagReport => ({
  id: 1,
  reason: "spam",
  details: null,
  reporter: OLA,
  createdAt: NOW,
  ...overrides,
})

describe("reportGroups", () => {
  it("groups reports by reason under their labels, keeping report order", () => {
    const first = report({ id: 1, reason: "offensive", details: "Slur in verse two" })
    const second = report({ id: 2, reason: "spam", details: "Ad link" })
    const third = report({ id: 3, reason: "offensive", reporter: null })
    expect(reportGroups([first, second, third])).toEqual([
      { reason: "offensive", label: "Offensive", reports: [first, third] },
      { reason: "spam", label: "Spam", reports: [second] },
    ])
  })

  it("labels a wrong song report", () => {
    expect(reportGroups([report({ reason: "wrong_song" })])[0].label).toBe("Wrong song")
  })

  describe("edge cases", () => {
    it("returns no groups for no reports", () => {
      expect(reportGroups([])).toEqual([])
    })

    it("gives a reason the web does not know its own trailing group", () => {
      const known = { reason: "spam", id: 1 }
      const unknown = { reason: "hate_speech", id: 2 }
      expect(reportGroups([unknown, known])).toEqual([
        { reason: "spam", label: "Spam", reports: [known] },
        { reason: "hate_speech", label: "Hate speech", reports: [unknown] },
      ])
    })
  })

  describe("invariants", () => {
    it("lists reasons in the report menu order", () => {
      const groups = reportGroups([
        report({ reason: "spam" }),
        report({ reason: "offensive" }),
        report({ reason: "wrong_song" }),
      ])
      expect(groups.map((g) => g.reason)).toEqual(["wrong_song", "offensive", "spam"])
    })

    it("keeps every report exactly once, known or not", () => {
      const reports = [{ reason: "spam" }, { reason: "mystery" }, { reason: "spam" }, { reason: "mystery" }]
      expect(reportGroups(reports).flatMap((g) => g.reports)).toHaveLength(reports.length)
    })
  })
})

describe("flagConflict", () => {
  it("names the submitter conflict", () => {
    expect(flagConflict(flagItem({ conflict: "submitter" }))).toBe("You submitted this lyric")
  })

  it("names the reporter conflict the server found", () => {
    expect(flagConflict(flagItem({ conflict: "reporter" }))).toBe("You reported this lyric")
  })

  it("lets a member without a conflict vote", () => {
    expect(flagConflict(flagItem())).toBeNull()
  })

  describe("regressions", () => {
    it("regression: trusts the server even when the member's report is not listed", () => {
      const flag = flagItem({ conflict: "reporter" })
      expect(flag.reports.some((r) => r.reporter?.keyId === "b0".repeat(32))).toBe(false)
      expect(flagConflict(flag)).toBe("You reported this lyric")
    })
  })
})
