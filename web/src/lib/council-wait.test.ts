import { NOW } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { waitBuckets } from "./council-wait"

const HOUR = 3600
const DAY = 86400

describe("waitBuckets", () => {
  it("sorts waiting items into five ranges", () => {
    const ages = [2 * HOUR, 20 * HOUR, 2 * DAY, 4 * DAY, 9 * DAY, 15 * DAY, 26 * DAY]
    expect(
      waitBuckets(
        ages.map((a) => NOW - a),
        NOW,
      ),
    ).toEqual([
      { label: "Under 1d", value: 2 },
      { label: "1 to 3d", value: 1 },
      { label: "3 to 7d", value: 1 },
      { label: "1 to 2w", value: 1 },
      { label: "Over 2w", value: 2 },
    ])
  })

  describe("edge cases", () => {
    it("returns every range at zero for no items", () => {
      expect(waitBuckets([], NOW).map((b) => b.value)).toEqual([0, 0, 0, 0, 0])
    })

    it("puts an item exactly on a boundary into the older range", () => {
      const values = waitBuckets([NOW - DAY, NOW - 3 * DAY, NOW - 7 * DAY, NOW - 14 * DAY], NOW).map((b) => b.value)
      expect(values).toEqual([0, 1, 1, 1, 1])
    })

    it("counts an item stamped in the future as under a day", () => {
      expect(waitBuckets([NOW + 60], NOW)[0].value).toBe(1)
    })
  })

  describe("invariants", () => {
    it("never loses or double counts an item", () => {
      const ages = Array.from({ length: 50 }, (_, i) => NOW - i * 11 * HOUR)
      expect(waitBuckets(ages, NOW).reduce((n, b) => n + b.value, 0)).toBe(50)
    })
  })
})
