import { describe, expect, it } from "vitest"
import { REPORT_REASONS, REPORT_REASON_LABEL, reportReasonLabel } from "./report-reasons"

describe("REPORT_REASONS", () => {
  it("lists the reasons in the order listeners see them", () => {
    expect(REPORT_REASONS).toEqual(["wrong_song", "bad_sync", "offensive", "spam", "other"])
  })

  describe("invariants", () => {
    it("labels every reason and nothing else", () => {
      expect(Object.keys(REPORT_REASON_LABEL).sort()).toEqual([...REPORT_REASONS].sort())
    })
  })
})

describe("reportReasonLabel", () => {
  it("names a known reason", () => {
    expect(reportReasonLabel("wrong_song")).toBe("Wrong song")
  })

  describe("edge cases", () => {
    it("falls back to a readable label for a reason the web does not know yet", () => {
      expect(reportReasonLabel("hate_speech")).toBe("Hate speech")
    })

    it("does not treat inherited object keys as reasons", () => {
      expect(reportReasonLabel("constructor")).toBe("Constructor")
    })
  })
})
