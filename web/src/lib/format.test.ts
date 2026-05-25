import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatRank, formatRelativeTime, formatVotes } from "./format"

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

describe("formatRelativeTime", () => {
  const now = 1_700_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now * 1000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders seconds for very recent timestamps", () => {
    expect(formatRelativeTime(now - 10)).toMatch(/second/)
  })

  it("renders minutes for timestamps within the hour", () => {
    expect(formatRelativeTime(now - 5 * 60)).toMatch(/minute/)
  })

  it("renders hours for timestamps within the day", () => {
    expect(formatRelativeTime(now - 3 * 3600)).toMatch(/hour/)
  })

  it("renders days for timestamps within the month", () => {
    expect(formatRelativeTime(now - 5 * 86400)).toMatch(/day/)
  })

  it("renders months for timestamps within the year", () => {
    expect(formatRelativeTime(now - 60 * 86400)).toMatch(/month/)
  })

  it("renders years for older timestamps", () => {
    expect(formatRelativeTime(now - 400 * 86400)).toMatch(/year/)
  })
})
