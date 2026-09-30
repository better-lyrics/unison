import { ME, NOW, OLA, councilEvent } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { EVENT_WORDS, canUndo, groupByDay } from "./council-activity"

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

  it("refuses a rejection that lapsed after the lyrics were edited", () => {
    const lapsed = councilEvent({ kind: "reject", actor: mine, at: NOW - HOUR, undone: false, active: false })
    expect(canUndo(lapsed, ME.keyId, NOW)).toBe(false)
  })

  it("refuses a seal that is no longer active", () => {
    expect(canUndo(councilEvent({ kind: "seal", actor: mine, active: false }), ME.keyId, NOW)).toBe(false)
  })

  describe("edge cases", () => {
    it("refuses a decision that names no seal or rejection", () => {
      expect(canUndo(councilEvent({ kind: "reject", actor: mine, refId: null }), ME.keyId, NOW)).toBe(false)
    })

    it("still allows undo exactly at the window edge", () => {
      expect(canUndo(councilEvent({ kind: "seal", actor: mine, at: NOW - 3 * DAY }), ME.keyId, NOW)).toBe(true)
    })

    it("needs a lyric to undo against", () => {
      expect(canUndo(councilEvent({ kind: "seal", actor: mine, lyric: null }), ME.keyId, NOW)).toBe(false)
    })
  })
})

describe("EVENT_WORDS", () => {
  it("reads every lyric decision as a sentence and on the lyric itself", () => {
    expect(`boidu ${EVENT_WORDS.reject.verb} Run Rabbit`).toBe("boidu rejected Run Rabbit")
    expect(`boidu ${EVENT_WORDS.reject.onOwnLyric}`).toBe("boidu rejected it")
    expect(`boidu ${EVENT_WORDS.member_add.verb} Ola ${EVENT_WORDS.member_add.after}`).toBe(
      "boidu added Ola to the council",
    )
  })

  describe("invariants", () => {
    it("gives a tone only to decisions that show on a lyric's history", () => {
      for (const words of Object.values(EVENT_WORDS)) {
        if (words.tone) expect(words.onOwnLyric).toBeTruthy()
      }
    })

    it("shows only lyric decisions on a lyric's history", () => {
      const onLyric = Object.entries(EVENT_WORDS)
        .filter(([, w]) => w.onOwnLyric)
        .map(([kind]) => kind)
      expect(onLyric).toEqual(["seal", "unseal", "reject", "unreject", "edit_approve", "edit_reject"])
    })
  })
})
