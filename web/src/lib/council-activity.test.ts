import { ME, NOW, OLA, councilEvent } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { canUndo, groupByDay } from "./council-activity"

const HOUR = 3600
const DAY = 86400

describe("groupByDay", () => {
  it("groups events under Today, Yesterday, then the full date, keeping order", () => {
    const startOfToday = new Date(NOW * 1000)
    startOfToday.setHours(0, 0, 0, 0)
    const today = startOfToday.getTime() / 1000
    const events = [
      councilEvent({ id: 1, at: today + 60 }),
      councilEvent({ id: 2, at: today + 10 }),
      councilEvent({ id: 3, at: today - HOUR }),
      councilEvent({ id: 4, at: today - DAY - HOUR }),
    ]
    const groups = groupByDay(events, NOW)
    expect(groups.map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ["Today", [1, 2]],
      ["Yesterday", [3]],
      [
        new Date((today - DAY - HOUR) * 1000).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        [4],
      ],
    ])
  })

  describe("edge cases", () => {
    it("returns no groups for no events", () => {
      expect(groupByDay([], NOW)).toEqual([])
    })
  })
})

describe("canUndo", () => {
  const mine = { ...ME, tier: undefined }

  it("allows undo on my own recent seal or rejection", () => {
    expect(canUndo(councilEvent({ kind: "seal", actor: mine, at: NOW - HOUR }), ME.keyId, NOW)).toBe(true)
    expect(canUndo(councilEvent({ kind: "reject", actor: mine, at: NOW - 2 * DAY }), ME.keyId, NOW)).toBe(true)
  })

  it("refuses other members' decisions, undone ones, old ones and kinds without an undo", () => {
    expect(canUndo(councilEvent({ kind: "seal", actor: { ...OLA }, at: NOW - HOUR }), ME.keyId, NOW)).toBe(false)
    expect(canUndo(councilEvent({ kind: "seal", actor: mine, undone: true }), ME.keyId, NOW)).toBe(false)
    expect(canUndo(councilEvent({ kind: "reject", actor: mine, at: NOW - 3 * DAY - 1 }), ME.keyId, NOW)).toBe(false)
    expect(canUndo(councilEvent({ kind: "edit_approve", actor: mine, at: NOW - HOUR }), ME.keyId, NOW)).toBe(false)
    expect(canUndo(councilEvent({ kind: "seal", actor: null, at: NOW - HOUR }), ME.keyId, NOW)).toBe(false)
  })

  describe("edge cases", () => {
    it("still allows undo exactly at the window edge", () => {
      expect(canUndo(councilEvent({ kind: "seal", actor: mine, at: NOW - 3 * DAY }), ME.keyId, NOW)).toBe(true)
    })

    it("needs a lyric to undo against", () => {
      expect(canUndo(councilEvent({ kind: "seal", actor: mine, lyric: null }), ME.keyId, NOW)).toBe(false)
    })
  })
})
