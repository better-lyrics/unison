import { ME, NOW, OLA, flagItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { flagConflict, reportGroups } from "./council-flags"
import type { FlagReport } from "./council-types"

const report = (overrides: Partial<FlagReport> = {}): FlagReport => ({
  reason: "spam",
  details: null,
  reporter: OLA,
  createdAt: NOW,
  ...overrides,
})

describe("reportGroups", () => {
  it("groups reports by reason under their labels, keeping report order", () => {
    const first = report({ reason: "offensive", details: "Slur in verse two" })
    const second = report({ reason: "spam", details: "Ad link" })
    const third = report({ reason: "offensive", reporter: null })
    expect(reportGroups([first, second, third])).toEqual([
      { reason: "spam", label: "Spam", reports: [second] },
      { reason: "offensive", label: "Offensive", reports: [first, third] },
    ])
  })

  it("labels a wrong song report", () => {
    expect(reportGroups([report({ reason: "wrong_song" })])[0].label).toBe("Wrong song")
  })

  describe("edge cases", () => {
    it("returns no groups for no reports", () => {
      expect(reportGroups([])).toEqual([])
    })
  })

  describe("invariants", () => {
    it("always lists spam, then wrong song, then offensive", () => {
      const groups = reportGroups([
        report({ reason: "offensive" }),
        report({ reason: "wrong_song" }),
        report({ reason: "spam" }),
      ])
      expect(groups.map((g) => g.reason)).toEqual(["spam", "wrong_song", "offensive"])
    })

    it("keeps every report exactly once", () => {
      const reports = [report(), report({ reason: "wrong_song" }), report()]
      expect(reportGroups(reports).flatMap((g) => g.reports)).toHaveLength(reports.length)
    })
  })
})

describe("flagConflict", () => {
  it("stops the submitter from voting on their own lyric", () => {
    expect(flagConflict(flagItem({ submitter: ME }), ME.keyId)).toBe("You submitted this lyric")
  })

  it("stops a reporter from voting on the flag they raised", () => {
    const flag = flagItem({ reports: [report({ reporter: ME })] })
    expect(flagConflict(flag, ME.keyId)).toBe("You reported this lyric")
  })

  it("lets any other member vote", () => {
    expect(flagConflict(flagItem(), ME.keyId)).toBeNull()
  })

  describe("edge cases", () => {
    it("lets members vote when the submitter and reporters are deleted accounts", () => {
      const flag = flagItem({ submitter: null, reports: [report({ reporter: null })] })
      expect(flagConflict(flag, ME.keyId)).toBeNull()
    })
  })
})
