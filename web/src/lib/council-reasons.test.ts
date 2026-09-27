import { editItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { reasonLabel, reasonMetric, reasonWhy } from "./council-reasons"

const thresholds = { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 }

describe("council reasons", () => {
  it("labels every pending reason", () => {
    expect(reasonLabel("sealed")).toBe("Sealed lyric")
    expect(reasonLabel("flagged")).toBe("Flagged by Jev")
    expect(reasonLabel("large_text_drift")).toBe("Large text change")
    expect(reasonLabel("large_timing_drift")).toBe("Large timing change")
  })

  it("explains drift reasons with the server thresholds", () => {
    expect(reasonWhy("large_text_drift", thresholds)).toBe("The words changed more than the 15% threshold.")
    expect(reasonWhy("large_timing_drift", { ...thresholds, timingDrift: 0.25 })).toBe(
      "Line timings moved more than the 25% threshold.",
    )
  })

  it("shows the number that put the edit in the queue", () => {
    expect(reasonMetric(editItem({ pendingReason: "sealed" }))).toBe("sealed")
    expect(reasonMetric(editItem({ pendingReason: "flagged", jevProbability: 0.843 }))).toBe("Jev 84%")
    expect(reasonMetric(editItem({ pendingReason: "large_text_drift", textDrift: 0.23 }))).toBe("23% text")
    expect(reasonMetric(editItem({ pendingReason: "large_timing_drift", timingDrift: 0.41 }))).toBe("41% timing")
  })

  describe("edge cases", () => {
    it("names Jev without a score when the score is missing", () => {
      expect(reasonMetric(editItem({ pendingReason: "flagged", jevProbability: null }))).toBe("Jev")
    })
  })
})
