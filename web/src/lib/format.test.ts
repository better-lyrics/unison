import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatCompact, formatExact, formatRank, formatRelativeTime } from "./format"

describe("formatRank", () => {
  it("renders rank as #N", () => {
    expect(formatRank(1)).toBe("#1")
    expect(formatRank(42)).toBe("#42")
  })
})

describe("formatCompact", () => {
  it("renders small integers verbatim", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(7)).toBe("7")
    expect(formatCompact(999)).toBe("999")
  })

  it("renders thousands with K suffix", () => {
    expect(formatCompact(1000)).toBe("1K")
    expect(formatCompact(1200)).toBe("1.2K")
    expect(formatCompact(12_345)).toBe("12.3K")
    expect(formatCompact(123_456)).toBe("123.5K")
  })

  it("crosses into M only at one million", () => {
    expect(formatCompact(999_500)).toBe("999.5K")
    expect(formatCompact(1_000_000)).toBe("1M")
  })

  it("renders millions with M suffix", () => {
    expect(formatCompact(1_234_567)).toBe("1.2M")
    expect(formatCompact(12_345_678)).toBe("12.3M")
  })

  it("renders billions with B suffix", () => {
    expect(formatCompact(1_000_000_000)).toBe("1B")
    expect(formatCompact(1_234_567_890)).toBe("1.2B")
  })
})

describe("formatExact", () => {
  it("renders small integers verbatim", () => {
    expect(formatExact(0)).toBe("0")
    expect(formatExact(42)).toBe("42")
  })

  it("renders thousands with a comma separator", () => {
    expect(formatExact(1234)).toBe("1,234")
    expect(formatExact(12_345)).toBe("12,345")
  })

  it("renders millions with two comma separators", () => {
    expect(formatExact(1_234_567)).toBe("1,234,567")
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

  it("handles now and future timestamps", () => {
    const now = Math.floor(Date.now() / 1000)
    expect(formatRelativeTime(now)).toBeTruthy()
    const futureRendered = formatRelativeTime(now + 30)
    expect(futureRendered.length).toBeGreaterThan(0)
  })
})
