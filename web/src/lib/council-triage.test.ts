import { ME, NOW, OLA, bookmarkBy, editItem, queueItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import {
  filterEdits,
  filterQueue,
  NO_FILTERS,
  groupByBookmark,
  languageFilters,
  neighbour,
  sortQueue,
  splitNew,
} from "./council-triage"

const HOUR = 3600

describe("groupByBookmark", () => {
  it("splits my bookmarks, open items and other members' bookmarks", () => {
    const mine = queueItem({ id: 1, bookmark: bookmarkBy(ME) })
    const open = queueItem({ id: 2 })
    const theirs = queueItem({ id: 3, bookmark: bookmarkBy(OLA, 2) })
    expect(groupByBookmark([mine, open, theirs], ME.keyId, NOW)).toEqual({
      mine: [mine],
      open: [open],
      others: [theirs],
    })
  })

  describe("edge cases", () => {
    it("treats a bookmark that ran out while the page was open as open", () => {
      const lapsed = queueItem({ bookmark: { ...bookmarkBy(OLA), expiresAt: NOW } })
      expect(groupByBookmark([lapsed], ME.keyId, NOW).open).toEqual([lapsed])
    })

    it("returns empty groups for no items", () => {
      expect(groupByBookmark([], ME.keyId, NOW)).toEqual({ mine: [], open: [], others: [] })
    })
  })

  describe("invariants", () => {
    it("keeps the input order inside each group and loses no item", () => {
      const items = [5, 4, 3, 2, 1].map((id) => queueItem({ id, bookmark: id % 2 ? null : bookmarkBy(OLA, id) }))
      const groups = groupByBookmark(items, ME.keyId, NOW)
      expect(groups.open.map((i) => i.id)).toEqual([5, 3, 1])
      expect(groups.mine.length + groups.open.length + groups.others.length).toBe(items.length)
    })
  })
})

describe("sortQueue", () => {
  const a = queueItem({ id: 1, score: 0.9, voteCount: 10, createdAt: NOW - 2 * HOUR })
  const b = queueItem({ id: 2, score: 0.95, voteCount: 5, createdAt: NOW - 5 * HOUR })
  const c = queueItem({ id: 3, score: 0.9, voteCount: 30, createdAt: NOW - HOUR })

  it("orders by score, then votes, for top rated", () => {
    expect(sortQueue([a, b, c], "top").map((i) => i.id)).toEqual([2, 3, 1])
  })

  it("orders by vote count for most voted", () => {
    expect(sortQueue([a, b, c], "votes").map((i) => i.id)).toEqual([3, 1, 2])
  })

  it("puts the longest waiting first", () => {
    expect(sortQueue([a, b, c], "waiting").map((i) => i.id)).toEqual([2, 1, 3])
  })

  describe("invariants", () => {
    it("does not reorder the input array", () => {
      const input = [a, b, c]
      sortQueue(input, "votes")
      expect(input.map((i) => i.id)).toEqual([1, 2, 3])
    })
  })
})

describe("filterQueue", () => {
  const items = [
    queueItem({ id: 1, song: "Catch Catch", artist: "YENA", language: "ko" }),
    queueItem({ id: 2, song: "misery.", flags: [{ code: "stretched-spelling", label: "Stretched spelling" }] }),
    queueItem({ id: 3, song: "Alone", artist: "Alan Walker" }),
  ]

  it("matches song, artist and submitter without case", () => {
    expect(filterQueue(items, { text: "yena", ...NO_FILTERS }).map((i) => i.id)).toEqual([1])
    expect(filterQueue(items, { text: "WALKER", ...NO_FILTERS }).map((i) => i.id)).toEqual([3])
    expect(filterQueue(items, { text: "sigmaviolin", ...NO_FILTERS }).map((i) => i.id)).toEqual([1, 2, 3])
  })

  it("keeps only items with automatic flags", () => {
    expect(filterQueue(items, { text: "", ...NO_FILTERS, flags: "flagged" }).map((i) => i.id)).toEqual([2])
  })

  it("keeps only items with no automatic flags", () => {
    expect(filterQueue(items, { text: "", ...NO_FILTERS, flags: "clean" }).map((i) => i.id)).toEqual([1, 3])
  })

  it("matches a pasted song link or video id", () => {
    const song = [queueItem({ id: 7, videoId: "Lnk0000001A" }), queueItem({ id: 8, videoId: "Other000001" })]
    const link = "https://music.youtube.com/watch?v=Lnk0000001A"
    expect(filterQueue(song, { text: link, ...NO_FILTERS }).map((i) => i.id)).toEqual([7])
    expect(filterQueue(song, { text: "Lnk0000001A", ...NO_FILTERS }).map((i) => i.id)).toEqual([7])
  })

  it("keeps any of several languages", () => {
    const mixed = [...items, queueItem({ id: 5, language: "ja" })]
    expect(filterQueue(mixed, { text: "", ...NO_FILTERS, languages: ["ko", "ja"] }).map((i) => i.id)).toEqual([1, 5])
  })

  it("combines the flag filter with languages and text", () => {
    const mixed = [
      ...items,
      queueItem({ id: 6, song: "Hana", language: "ko", flags: [{ code: "filler-line", label: "Filler" }] }),
    ]
    expect(filterQueue(mixed, { text: "", flags: "flagged", languages: ["ko"] }).map((i) => i.id)).toEqual([6])
    expect(filterQueue(mixed, { text: "", flags: "clean", languages: ["ko"] }).map((i) => i.id)).toEqual([1])
    expect(filterQueue(mixed, { text: "catch", flags: "flagged", languages: ["ko"] })).toEqual([])
  })

  it("keeps only one language", () => {
    expect(filterQueue(items, { text: "", ...NO_FILTERS, languages: ["ko"] }).map((i) => i.id)).toEqual([1])
  })

  describe("edge cases", () => {
    it("ignores surrounding whitespace in the search", () => {
      expect(filterQueue(items, { text: "  alone ", ...NO_FILTERS }).map((i) => i.id)).toEqual([3])
    })

    it("matches accented and non-Latin text", () => {
      const sesi = queueItem({ id: 9, artist: "eńau, Ari Lesmana" })
      const korean = queueItem({ id: 10, song: "사랑" })
      expect(filterQueue([sesi, korean], { text: "eńau", ...NO_FILTERS }).map((i) => i.id)).toEqual([9])
      expect(filterQueue([sesi, korean], { text: "사랑", ...NO_FILTERS }).map((i) => i.id)).toEqual([10])
    })

    it("handles an item without a submitter or language", () => {
      const bare = queueItem({ id: 4, submitter: null, language: null })
      expect(filterQueue([bare], { text: "sigma", ...NO_FILTERS })).toEqual([])
      expect(filterQueue([bare], { text: "", ...NO_FILTERS, languages: ["en"] })).toEqual([])
    })
  })
})

describe("languageFilters", () => {
  it("lists the most common languages first, at most four", () => {
    const langs = ["en", "en", "en", "ko", "ko", "pt", "ms", "ja", null]
    const items = langs.map((language, id) => queueItem({ id, language }))
    expect(languageFilters(items)).toEqual(["en", "ko", "ja", "ms"])
  })

  it("is empty when no item has a language", () => {
    expect(languageFilters([queueItem({ language: null })])).toEqual([])
  })
})

describe("filterEdits", () => {
  it("matches song, artist and author and lists the oldest first", () => {
    const newer = editItem({ revisionId: 1, createdAt: NOW - HOUR })
    const older = editItem({ revisionId: 2, createdAt: NOW - 9 * HOUR, song: "Alone" })
    expect(filterEdits([newer, older], "").map((e) => e.revisionId)).toEqual([2, 1])
    expect(filterEdits([newer, older], "alone").map((e) => e.revisionId)).toEqual([2])
    expect(filterEdits([newer, older], "yes").map((e) => e.revisionId)).toEqual([2, 1])
  })
})

describe("splitNew", () => {
  it("returns keys that were not seen before, in order", () => {
    expect(splitNew(new Set(["a", "b"]), ["c", "a", "d", "b"])).toEqual(["c", "d"])
  })

  describe("edge cases", () => {
    it("is empty when nothing is new or the list is empty", () => {
      expect(splitNew(new Set(["a"]), ["a"])).toEqual([])
      expect(splitNew(new Set(), [])).toEqual([])
    })
  })
})

describe("neighbour", () => {
  const keys = ["a", "b", "c"]

  it("steps forward and back", () => {
    expect(neighbour(keys, "a", 1)).toBe("b")
    expect(neighbour(keys, "c", -1)).toBe("b")
  })

  describe("edge cases", () => {
    it("stays on the last or first item at the ends", () => {
      expect(neighbour(keys, "c", 1)).toBe("c")
      expect(neighbour(keys, "a", -1)).toBe("a")
    })

    it("starts at the top when nothing or a vanished item is selected", () => {
      expect(neighbour(keys, null, 1)).toBe("a")
      expect(neighbour(keys, "gone", -1)).toBe("a")
    })

    it("returns null for an empty list", () => {
      expect(neighbour([], null, 1)).toBeNull()
    })
  })
})
