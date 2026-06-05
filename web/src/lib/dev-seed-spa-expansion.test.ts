import { beforeEach, describe, expect, it } from "vitest"
import {
  SEED_LYRICS_CORPUS,
  SEED_QUEUE_ENTRIES,
  __resetSpaExpansionSeedState,
  seedLyricsVariant,
  seedLyricsVariants,
  seedQueue,
  seedReport,
  seedSearch,
  seedSongs,
  seedUnvote,
  seedVote,
} from "./dev-seed-spa-expansion"
import { getSeedSession } from "./seed-flag"

beforeEach(() => {
  __resetSpaExpansionSeedState()
})

describe("SEED_LYRICS_CORPUS", () => {
  it("contains at least 8 distinct video IDs", () => {
    const videoIds = new Set(SEED_LYRICS_CORPUS.map((v) => v.videoId))
    expect(videoIds.size).toBeGreaterThanOrEqual(8)
  })

  it("covers all three formats", () => {
    const formats = new Set(SEED_LYRICS_CORPUS.map((v) => v.format))
    expect(formats).toContain("ttml")
    expect(formats).toContain("lrc")
    expect(formats).toContain("plain")
  })

  it("has variants with non-empty lyrics bodies", () => {
    for (const v of SEED_LYRICS_CORPUS) {
      expect(v.lyrics.length).toBeGreaterThan(0)
    }
  })

  it("has at least three videoIds with multiple variants", () => {
    const counts = new Map<string, number>()
    for (const v of SEED_LYRICS_CORPUS) {
      counts.set(v.videoId, (counts.get(v.videoId) ?? 0) + 1)
    }
    const multi = [...counts.values()].filter((n) => n > 1)
    expect(multi.length).toBeGreaterThanOrEqual(3)
  })

  it("has at least one variant with hidden=true", () => {
    expect(SEED_LYRICS_CORPUS.some((v) => v.hidden)).toBe(true)
  })

  it("covers all three userVote states across variants", () => {
    const votes = new Set(SEED_LYRICS_CORPUS.map((v) => v.userVote ?? null))
    expect(votes).toContain(1)
    expect(votes).toContain(-1)
    expect(votes).toContain(null)
  })

  it("covers all three confidence buckets", () => {
    const confidences = new Set(SEED_LYRICS_CORPUS.map((v) => v.confidence))
    expect(confidences).toContain("low")
    expect(confidences).toContain("medium")
    expect(confidences).toContain("high")
  })

  it("attaches a submitter to at least half of variants", () => {
    const withSubmitter = SEED_LYRICS_CORPUS.filter((v) => v.submitter)
    expect(withSubmitter.length).toBeGreaterThanOrEqual(Math.ceil(SEED_LYRICS_CORPUS.length / 2))
    for (const v of withSubmitter) {
      const submitter = v.submitter
      if (!submitter) throw new Error("expected submitter")
      expect(submitter.keyId).toMatch(/^[0-9a-f]{64}$/)
      expect(submitter.reputation).toBeGreaterThanOrEqual(0.5)
      expect(submitter.reputation).toBeLessThanOrEqual(1.8)
    }
  })

  it("assigns distinct ids to every variant", () => {
    const ids = new Set(SEED_LYRICS_CORPUS.map((v) => v.id))
    expect(ids.size).toBe(SEED_LYRICS_CORPUS.length)
  })
})

describe("seedSearch", () => {
  it("returns mixed tier-1, tier-2, and tier-3 hits for 'midnight'", async () => {
    const { results } = await seedSearch({ q: "midnight" })
    const tier1And2 = results.filter((r) => r.matchScore === undefined)
    const tier3 = results.filter((r) => typeof r.matchScore === "number")
    expect(tier1And2.length).toBeGreaterThanOrEqual(3)
    expect(tier3.length).toBeGreaterThanOrEqual(2)
    for (const hit of tier3) {
      expect(hit.matchScore).toBeGreaterThan(0)
      expect(hit.matchScore).toBeLessThanOrEqual(1)
    }
  })

  it("returns search hits that overlap with the corpus videoIds", async () => {
    const { results } = await seedSearch({ q: "midnight" })
    const corpusIds = new Set(SEED_LYRICS_CORPUS.map((v) => v.videoId))
    expect(results.some((r) => corpusIds.has(r.videoId))).toBe(true)
  })

  it("returns at most five substring matches for non-curated queries", async () => {
    const { results } = await seedSearch({ q: "the" })
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it("returns an empty list when nothing matches", async () => {
    const { results } = await seedSearch({ q: "zzzzz-no-match-zzzz" })
    expect(results).toEqual([])
  })

  it("respects song and artist params", async () => {
    const sample = SEED_LYRICS_CORPUS[0]
    const { results } = await seedSearch({ song: sample.song })
    expect(results.some((r) => r.videoId === sample.videoId)).toBe(true)
  })
})

describe("SEED_QUEUE_ENTRIES", () => {
  it("has at least 30 entries", () => {
    expect(SEED_QUEUE_ENTRIES.length).toBeGreaterThanOrEqual(30)
  })

  it("ranks entries with strictly decreasing demand", () => {
    for (let i = 1; i < SEED_QUEUE_ENTRIES.length; i += 1) {
      expect(SEED_QUEUE_ENTRIES[i].demand).toBeLessThanOrEqual(SEED_QUEUE_ENTRIES[i - 1].demand)
    }
  })

  it("uses unique video IDs", () => {
    const ids = new Set(SEED_QUEUE_ENTRIES.map((e) => e.videoId))
    expect(ids.size).toBe(SEED_QUEUE_ENTRIES.length)
  })

  it("uses 1-based rank values", () => {
    expect(SEED_QUEUE_ENTRIES[0].rank).toBe(1)
  })
})

describe("seedQueue", () => {
  it("paginates so the first page yields a next cursor", async () => {
    const first = await seedQueue({})
    expect(first.items.length).toBeGreaterThan(0)
    expect(first.items.length).toBeLessThan(SEED_QUEUE_ENTRIES.length)
    expect(first.nextCursor).not.toBeNull()
  })

  it("walks every entry without duplicates and ends with a null cursor", async () => {
    const seen: string[] = []
    let cursor: string | undefined
    let guard = 0
    while (guard < 10) {
      const page = await seedQueue({ cursor })
      seen.push(...page.items.map((item) => item.videoId))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
      guard += 1
    }
    expect(seen.length).toBe(SEED_QUEUE_ENTRIES.length)
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe("seedSongs", () => {
  it("returns at least one entry for each section", async () => {
    const { mostWanted, needsFixing } = await seedSongs()
    expect(mostWanted.length).toBeGreaterThan(0)
    expect(needsFixing.length).toBeGreaterThan(0)
  })
})

describe("seedLyricsVariants", () => {
  it("returns all variants for a known videoId", async () => {
    const videoId = SEED_LYRICS_CORPUS[0].videoId
    const { variants } = await seedLyricsVariants(videoId)
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      expect(v.videoId).toBe(videoId)
    }
  })

  it("returns an empty array for an unknown videoId", async () => {
    const { variants } = await seedLyricsVariants("zzz-no-match")
    expect(variants).toEqual([])
  })
})

describe("seedLyricsVariant", () => {
  it("returns the full variant including lyrics", async () => {
    const sample = SEED_LYRICS_CORPUS[0]
    const { variant } = await seedLyricsVariant(sample.id)
    expect(variant.id).toBe(sample.id)
    expect(variant.lyrics.length).toBeGreaterThan(0)
  })

  it("throws for an unknown variant id", async () => {
    await expect(seedLyricsVariant(-1)).rejects.toThrow()
  })
})

describe("getSeedSession", () => {
  it("returns a mock signed-in session", () => {
    const session = getSeedSession()
    if (!session) throw new Error("expected a session")
    expect(session.sessionToken).toBe("spa-expansion-dev-token")
    expect(session.keyId).toMatch(/^[0-9a-f]{64}$/)
    expect(session.displayName.length).toBeGreaterThan(0)
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })
})

describe("seedVote", () => {
  it("updates the in-memory variant userVote and counts", async () => {
    const neutralVariant = SEED_LYRICS_CORPUS.find((v) => (v.userVote ?? null) === null)
    if (!neutralVariant) throw new Error("expected at least one neutral variant")
    const before = (await seedLyricsVariant(neutralVariant.id)).variant
    await seedVote(neutralVariant.id, 1)
    const after = (await seedLyricsVariant(neutralVariant.id)).variant
    expect(after.userVote).toBe(1)
    expect(after.voteCount).toBe(before.voteCount + 1)
    expect(after.score).toBe(before.score + 1)
  })

  it("flips a previous downvote to an upvote: voteCount stays, score swings by two", async () => {
    const downvoted = SEED_LYRICS_CORPUS.find((v) => v.userVote === -1)
    if (!downvoted) throw new Error("expected a downvoted variant")
    const before = (await seedLyricsVariant(downvoted.id)).variant
    await seedVote(downvoted.id, 1)
    const after = (await seedLyricsVariant(downvoted.id)).variant
    expect(after.userVote).toBe(1)
    expect(after.voteCount).toBe(before.voteCount)
    expect(after.score).toBe(before.score + 2)
  })
})

describe("seedUnvote", () => {
  it("clears the userVote and decrements the count", async () => {
    const upvoted = SEED_LYRICS_CORPUS.find((v) => v.userVote === 1)
    if (!upvoted) throw new Error("expected an upvoted variant")
    const before = (await seedLyricsVariant(upvoted.id)).variant
    await seedUnvote(upvoted.id)
    const after = (await seedLyricsVariant(upvoted.id)).variant
    expect(after.userVote).toBeNull()
    expect(after.voteCount).toBe(before.voteCount - 1)
    expect(after.score).toBe(before.score - 1)
  })
})

describe("seedReport", () => {
  it("resolves without throwing for a known variant", async () => {
    const sample = SEED_LYRICS_CORPUS[0]
    await expect(seedReport(sample.id, "spam")).resolves.toBeUndefined()
  })
})
