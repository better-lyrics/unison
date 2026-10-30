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

describe("canUndo on a vote strike", () => {
  const strike = (overrides: Parameters<typeof councilEvent>[0] = {}) =>
    councilEvent({
      kind: "vote_strike",
      source: "system",
      actor: null,
      subject: { ...OLA },
      lyric: null,
      refId: 31,
      note: "ring: 59 keys, 63 votes (repeat)",
      ...overrides,
    })

  it("lets any council admin undo an active strike", () => {
    expect(canUndo(strike(), ME.keyId, NOW, true)).toBe(true)
  })

  it("refuses a member who is not an admin", () => {
    expect(canUndo(strike(), ME.keyId, NOW, false)).toBe(false)
    expect(canUndo(strike(), ME.keyId, NOW)).toBe(false)
  })

  it("refuses a strike that is undone or no longer active", () => {
    expect(canUndo(strike({ undone: true }), ME.keyId, NOW, true)).toBe(false)
    expect(canUndo(strike({ active: false }), ME.keyId, NOW, true)).toBe(false)
  })

  it("refuses an undo of the undo", () => {
    expect(canUndo(strike({ kind: "vote_strike_undo" }), ME.keyId, NOW, true)).toBe(false)
  })

  describe("edge cases", () => {
    it("refuses a strike that names no strike row", () => {
      expect(canUndo(strike({ refId: null }), ME.keyId, NOW, true)).toBe(false)
    })

    it("has no time window", () => {
      expect(canUndo(strike({ at: NOW - 90 * DAY }), ME.keyId, NOW, true)).toBe(true)
    })
  })

  describe("invariants", () => {
    it("keeps seal and rejection undo to the member who decided, admin or not", () => {
      const mine = { ...ME, tier: undefined }
      expect(canUndo(councilEvent({ kind: "seal", actor: { ...OLA }, at: NOW - HOUR }), ME.keyId, NOW, true)).toBe(
        false,
      )
      expect(canUndo(councilEvent({ kind: "reject", actor: mine, at: NOW - 3 * DAY - 1 }), ME.keyId, NOW, true)).toBe(
        false,
      )
      expect(canUndo(councilEvent({ kind: "seal", actor: mine, at: NOW - HOUR }), ME.keyId, NOW, true)).toBe(true)
    })
  })
})

describe("EVENT_WORDS", () => {
  it("reads vote checks as a sentence", () => {
    expect(`Vote check ${EVENT_WORDS.vote_strike.verb} olafix52`).toBe("Vote check discounted fake votes for olafix52")
    expect(`boidu ${EVENT_WORDS.vote_strike_undo.verb} olafix52`).toBe("boidu restored the votes for olafix52")
    expect(EVENT_WORDS.vote_strike.tone).toBe("reject")
  })

  it("reads every lyric decision as a sentence and on the lyric itself", () => {
    expect(`boidu ${EVENT_WORDS.reject.verb} Run Rabbit`).toBe("boidu rejected Run Rabbit")
    expect(`boidu ${EVENT_WORDS.reject.onOwnLyric}`).toBe("boidu rejected it")
    expect(`boidu ${EVENT_WORDS.member_add.verb} Ola ${EVENT_WORDS.member_add.after}`).toBe(
      "boidu added Ola to the council",
    )
  })

  it("reads flag votes as a sentence", () => {
    expect(`boidu ${EVENT_WORDS.flag_remove.verb} Run Rabbit`).toBe("boidu voted to remove Run Rabbit")
    expect(`boidu ${EVENT_WORDS.flag_keep.verb} Run Rabbit`).toBe("boidu kept Run Rabbit")
  })

  describe("invariants", () => {
    it("gives a tone only to decisions that show on a lyric's history, and to vote strikes", () => {
      // A vote strike is a decision about a person, not a lyric, so it has a tone but no lyric history line.
      for (const [kind, words] of Object.entries(EVENT_WORDS)) {
        if (words.tone && kind !== "vote_strike") expect(words.onOwnLyric).toBeTruthy()
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
