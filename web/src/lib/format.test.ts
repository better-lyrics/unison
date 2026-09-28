import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  formatCompact,
  formatDuration,
  formatElapsed,
  formatExact,
  formatRank,
  formatRelativeTime,
  formatRemaining,
  formatShortDate,
  plural,
  titleCase,
} from "./format"

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

describe("formatDuration", () => {
  it("renders seconds as M:SS with zero padding", () => {
    expect(formatDuration(7)).toBe("0:07")
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(222)).toBe("3:42")
  })

  it("renders durations of 10+ minutes", () => {
    expect(formatDuration(600)).toBe("10:00")
    expect(formatDuration(3725)).toBe("62:05")
  })

  it("floors fractional seconds", () => {
    expect(formatDuration(65.9)).toBe("1:05")
  })

  it("returns an empty string for zero, negative, or non-finite input", () => {
    expect(formatDuration(0)).toBe("")
    expect(formatDuration(-1)).toBe("")
    expect(formatDuration(Number.NaN)).toBe("")
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("")
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

describe("formatShortDate", () => {
  it("renders the month and day of an epoch second", () => {
    expect(formatShortDate(Date.UTC(2026, 9, 1, 12) / 1000)).toBe("Oct 1")
    expect(formatShortDate(Date.UTC(2026, 11, 31, 12) / 1000)).toBe("Dec 31")
  })
})

describe("titleCase", () => {
  it("capitalises the first letter only", () => {
    expect(titleCase("elite")).toBe("Elite")
    expect(titleCase("grandmaster")).toBe("Grandmaster")
  })

  describe("edge cases", () => {
    it("keeps an empty string and an already capitalised word", () => {
      expect(titleCase("")).toBe("")
      expect(titleCase("Elite")).toBe("Elite")
    })
  })
})

describe("formatElapsed", () => {
  it("picks minutes, hours, days, then weeks", () => {
    expect(formatElapsed(5 * 60)).toBe("5m")
    expect(formatElapsed(3 * 3600)).toBe("3h")
    expect(formatElapsed(4 * 86400 + 3 * 3600)).toBe("4d")
    expect(formatElapsed(20 * 86400)).toBe("3w")
  })

  describe("edge cases", () => {
    it("never shows zero minutes, even for a future or zero age", () => {
      expect(formatElapsed(0)).toBe("1m")
      expect(formatElapsed(-30)).toBe("1m")
    })

    it("switches units exactly at the hour, day and two week marks", () => {
      expect(formatElapsed(3599)).toBe("60m")
      expect(formatElapsed(3600)).toBe("1h")
      expect(formatElapsed(86400)).toBe("1d")
      expect(formatElapsed(14 * 86400 - 1)).toBe("14d")
      expect(formatElapsed(14 * 86400)).toBe("2w")
    })
  })
})

describe("formatRemaining", () => {
  it("shows days and hours, then hours, then minutes", () => {
    expect(formatRemaining(2 * 86400 + 5 * 3600 + 59)).toBe("2d 5h")
    expect(formatRemaining(5 * 3600 + 40 * 60)).toBe("5h")
    expect(formatRemaining(40 * 60)).toBe("40m")
  })

  describe("edge cases", () => {
    it("floors instead of rounding so the countdown never overstates", () => {
      expect(formatRemaining(86400 - 1)).toBe("23h")
      expect(formatRemaining(59)).toBe("0m")
    })

    it("clamps an expired countdown to zero", () => {
      expect(formatRemaining(-100)).toBe("0m")
    })
  })
})

describe("plural", () => {
  it("uses the singular only for exactly one", () => {
    expect(plural(1, "edit", "edits")).toBe("1 edit")
    expect(plural(0, "edit", "edits")).toBe("0 edits")
    expect(plural(2, "applicant needs", "applicants need")).toBe("2 applicants need")
  })
})
