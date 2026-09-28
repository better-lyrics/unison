import { ME, NOW, OLA, rosterMember } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { isInactive, parseMemberInput, sortRoster } from "./council-roster"

const DAY = 86400

describe("sortRoster", () => {
  const quiet = rosterMember(
    { ...OLA, keyId: "0c".repeat(32), displayName: "Ado" },
    {
      lastActiveAt: null,
      weekly: [0, 0, 0, 0, 0, 0, 0, 0],
      quota: { quota: 3, used: 0, remaining: 3, resetsAt: NOW },
    },
  )
  const busy = rosterMember(OLA, {
    lastActiveAt: NOW - 5 * DAY,
    weekly: [9, 9, 9, 9, 9, 9, 9, 9],
    quota: { quota: 3, used: 1, remaining: 2, resetsAt: NOW },
  })
  const recent = rosterMember(ME, {
    lastActiveAt: NOW - 60,
    weekly: [1, 0, 0, 0, 0, 0, 0, 1],
    quota: { quota: 3, used: 3, remaining: 0, resetsAt: NOW },
  })
  const names = (rows: ReturnType<typeof sortRoster>) => rows.map((r) => r.displayName)

  it("sorts by last activity with never active members last", () => {
    expect(names(sortRoster([quiet, busy, recent], "activity"))).toEqual(["boidu", "olafix52", "Ado"])
  })

  it("sorts by decisions over eight weeks", () => {
    expect(names(sortRoster([quiet, recent, busy], "decisions"))).toEqual(["olafix52", "boidu", "Ado"])
  })

  it("sorts by seals used this month", () => {
    expect(names(sortRoster([quiet, busy, recent], "seals"))).toEqual(["boidu", "olafix52", "Ado"])
  })

  describe("invariants", () => {
    it("does not reorder the input", () => {
      const input = [quiet, busy, recent]
      sortRoster(input, "seals")
      expect(names(input)).toEqual(["Ado", "olafix52", "boidu"])
    })
  })
})

describe("isInactive", () => {
  it("flags members quiet for more than two weeks or never active", () => {
    expect(isInactive(rosterMember(ME, { lastActiveAt: NOW - 15 * DAY }), NOW)).toBe(true)
    expect(isInactive(rosterMember(ME, { lastActiveAt: null }), NOW)).toBe(true)
    expect(isInactive(rosterMember(ME, { lastActiveAt: NOW - 14 * DAY }), NOW)).toBe(false)
  })
})

describe("parseMemberInput", () => {
  it("reads a key id or a handle", () => {
    expect(parseMemberInput(`  ${"AB".repeat(32)} `)).toEqual({ kind: "keyId", value: "ab".repeat(32) })
    expect(parseMemberInput("@susiisthebest")).toEqual({ kind: "handle", value: "susiisthebest" })
    expect(parseMemberInput("GoldenKickWhisper")).toEqual({ kind: "handle", value: "GoldenKickWhisper" })
  })

  describe("edge cases", () => {
    it("rejects empty input and a lone at sign", () => {
      expect(parseMemberInput("   ")).toBeNull()
      expect(parseMemberInput("@")).toBeNull()
    })

    it("treats a short hex string as a handle", () => {
      expect(parseMemberInput("abc123")).toEqual({ kind: "handle", value: "abc123" })
    })
  })
})
