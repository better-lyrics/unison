import { describe, expect, it } from "vitest"
import { formatRank, formatVotes } from "./format"

describe("formatRank", () => {
  it("renders rank as #N", () => {
    expect(formatRank(1)).toBe("#1")
    expect(formatRank(42)).toBe("#42")
  })
})

describe("formatVotes", () => {
  it("renders integers verbatim", () => {
    expect(formatVotes(0)).toBe("0")
    expect(formatVotes(7)).toBe("7")
  })

  it("renders thousands with k suffix", () => {
    expect(formatVotes(1200)).toBe("1.2k")
    expect(formatVotes(12345)).toBe("12.3k")
  })
})
