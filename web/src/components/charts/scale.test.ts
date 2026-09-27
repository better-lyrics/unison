import { describe, expect, it } from "vitest"
import { axisTicks, chartMax, roundedTopPath } from "./scale"

describe("chartMax", () => {
  it("uses the largest value with a floor so tiny series still have room", () => {
    expect(chartMax([1, 2, 3])).toBe(4)
    expect(chartMax([9, 2])).toBe(9)
  })

  describe("edge cases", () => {
    it("handles an empty or all-zero series", () => {
      expect(chartMax([])).toBe(4)
      expect(chartMax([0, 0])).toBe(4)
    })

    it("respects a custom floor", () => {
      expect(chartMax([1], 1)).toBe(1)
    })
  })
})

describe("axisTicks", () => {
  it("returns zero, the midpoint and the max", () => {
    expect(axisTicks(8)).toEqual([0, 4, 8])
    expect(axisTicks(7)).toEqual([0, 4, 7])
  })

  it("drops a duplicate midpoint", () => {
    expect(axisTicks(1)).toEqual([0, 1])
  })
})

describe("roundedTopPath", () => {
  it("rounds only the top corners", () => {
    expect(roundedTopPath(10, 20, 8, 30, 4)).toBe("M10,50V24Q10,20 14,20H14Q18,20 18,24V50Z")
  })

  describe("edge cases", () => {
    it("clamps the radius to the bar size", () => {
      expect(roundedTopPath(0, 0, 4, 1, 4)).toBe("M0,1V1Q0,0 1,0H3Q4,0 4,1V1Z")
    })

    it("draws nothing for a zero-height bar", () => {
      expect(roundedTopPath(0, 0, 4, 0, 4)).toBe("")
    })
  })
})
