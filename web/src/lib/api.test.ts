import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StoredSession } from "./auth"
import { AUTHED_FETCH_ERRORS } from "./authedFetch"

const loadStoredSessionMock = vi.fn<() => StoredSession | null>()

vi.mock("@/lib/auth", () => ({
  loadStoredSession: () => loadStoredSessionMock(),
}))

import {
  fetchCuratorLeaderboard,
  fetchLyricsVariant,
  fetchLyricsVariants,
  fetchQueue,
  fetchSongLeaderboard,
  fetchUserRank,
  fetchUserSubmissions,
  reportVariant,
  searchLyrics,
  unvoteVariant,
  voteVariant,
} from "./api"

beforeEach(() => {
  loadStoredSessionMock.mockReset()
  loadStoredSessionMock.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, ok = true): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(body), { status: ok ? 200 : 500 }))
}

describe("fetchSongLeaderboard", () => {
  it("returns the data envelope on a successful fetch", async () => {
    mockFetchOnce({
      success: true,
      data: { mostWanted: [{ videoId: "v1", rank: 1, song: "s", artist: "a" }], needsFixing: [] },
    })
    const data = await fetchSongLeaderboard()
    expect(data.mostWanted).toHaveLength(1)
    expect(data.mostWanted[0].videoId).toBe("v1")
    expect(data.needsFixing).toEqual([])
  })

  it("throws when the envelope is not successful", async () => {
    mockFetchOnce({ success: false, error: "boom" })
    await expect(fetchSongLeaderboard()).rejects.toThrow(/boom/)
  })

  it("throws on a non-2xx response", async () => {
    mockFetchOnce({ success: false }, false)
    await expect(fetchSongLeaderboard()).rejects.toThrow()
  })
})

describe("fetchCuratorLeaderboard", () => {
  it("returns curators", async () => {
    mockFetchOnce({ success: true, data: { curators: [{ keyId: "k", rank: 1, displayName: "X" }] } })
    const data = await fetchCuratorLeaderboard()
    expect(data.curators).toHaveLength(1)
  })
})

describe("fetchUserRank", () => {
  it("returns the ranked entry when present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            ranked: true,
            keyId: "k",
            displayName: "X",
            reputation: 1,
            score: 3.3,
            submissionCount: 1,
            totalUpvotes: 2,
            rank: 47,
            lastVoteAt: 1700000000,
          },
        }),
        { status: 200 },
      ),
    )
    const data = await fetchUserRank("k")
    expect(data.ranked).toBe(true)
    if (data.ranked) expect(data.rank).toBe(47)
    expect(data.lastVoteAt).toBe(1700000000)
    expect(fetchSpy).toHaveBeenCalledWith("/leaderboard/users/k")
  })

  it("returns ranked=false when the user is not on the leaderboard", async () => {
    mockFetchOnce({
      success: true,
      data: { ranked: false, keyId: "k", displayName: "X", lastVoteAt: null },
    })
    const data = await fetchUserRank("k")
    expect(data.ranked).toBe(false)
    expect(data.lastVoteAt).toBeNull()
  })

  it("url-encodes the keyId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { ranked: false, keyId: "a/b c", displayName: "X", lastVoteAt: null },
        }),
        { status: 200 },
      ),
    )
    await fetchUserRank("a/b c")
    expect(fetchSpy).toHaveBeenCalledWith("/leaderboard/users/a%2Fb%20c")
  })

  it("throws when the envelope is not successful", async () => {
    mockFetchOnce({ success: false, error: "nope" })
    await expect(fetchUserRank("k")).rejects.toThrow(/nope/)
  })
})

describe("fetchUserSubmissions", () => {
  it("fetches the first page without a cursor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            submissions: [
              {
                id: 1,
                videoId: "v1",
                song: "Song",
                artist: "Artist",
                duration: 200,
                format: "ttml",
                syncType: "richsync",
                effectiveScore: 5.5,
                voteCount: 3,
                confidence: "medium",
                createdAt: 1700000000,
                hidden: false,
              },
            ],
            nextCursor: "1699999999:42",
          },
        }),
        { status: 200 },
      ),
    )
    const data = await fetchUserSubmissions("k")
    expect(data.submissions).toHaveLength(1)
    expect(data.submissions[0].id).toBe(1)
    expect(data.nextCursor).toBe("1699999999:42")
    expect(fetchSpy).toHaveBeenCalledWith("/users/k/submissions")
  })

  it("forwards the cursor as a query param", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { submissions: [] },
        }),
        { status: 200 },
      ),
    )
    const data = await fetchUserSubmissions("k", "1699999999:42")
    expect(data.submissions).toEqual([])
    expect(data.nextCursor).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith("/users/k/submissions?cursor=1699999999%3A42")
  })

  it("url-encodes the keyId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
      )
    await fetchUserSubmissions("a/b c")
    expect(fetchSpy).toHaveBeenCalledWith("/users/a%2Fb%20c/submissions")
  })

  it("throws when the envelope is not successful", async () => {
    mockFetchOnce({ success: false, error: "nope" })
    await expect(fetchUserSubmissions("k")).rejects.toThrow(/nope/)
  })
})

const session: StoredSession = {
  sessionToken: "tok.abc",
  keyId: "k".repeat(64),
  displayName: "Tester",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function getCallUrl(spy: unknown, index = 0): string {
  const calls = (spy as { mock: { calls: unknown[][] } }).mock.calls
  const input = calls[index][0]
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return String(input)
}

function getCallInit(spy: unknown, index = 0): RequestInit | undefined {
  const calls = (spy as { mock: { calls: unknown[][] } }).mock.calls
  return calls[index][1] as RequestInit | undefined
}

describe("searchLyrics", () => {
  it("builds a query-string with just q", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    const result = await searchLyrics({ q: "love" })
    expect(result.results).toEqual([])
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/search?q=love")
  })

  it("omits empty song and artist when only q is supplied", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    await searchLyrics({ q: "x" })
    const url = getCallUrl(fetchSpy)
    expect(url).toContain("q=x")
    expect(url).not.toContain("song=")
    expect(url).not.toContain("artist=")
  })

  it("uses song and artist when q is absent", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    await searchLyrics({ song: "Cruel Summer", artist: "Taylor Swift" })
    const url = getCallUrl(fetchSpy)
    expect(url).toContain("song=Cruel+Summer")
    expect(url).toContain("artist=Taylor+Swift")
    expect(url).not.toContain("q=")
  })

  it("returns the parsed hits in a results envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 7,
              videoId: "v7",
              song: "S",
              artist: "A",
              duration: 200,
              format: "ttml",
              syncType: "richsync",
              score: 5,
              effectiveScore: 5.5,
              voteCount: 3,
              confidence: "medium",
              matchScore: 0.87,
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await searchLyrics({ q: "love" })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].id).toBe(7)
    expect(result.results[0].matchScore).toBe(0.87)
  })

  it("forwards the abort signal to fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    const controller = new AbortController()
    await searchLyrics({ q: "x", signal: controller.signal })
    expect(getCallInit(fetchSpy)?.signal).toBe(controller.signal)
  })

  it("throws on a 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("oops", { status: 500 }))
    await expect(searchLyrics({ q: "x" })).rejects.toThrow(/HTTP 500/)
  })

  it("throws on an error envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "nope" }), { status: 200 }),
    )
    await expect(searchLyrics({ q: "x" })).rejects.toThrow(/nope/)
  })

  it("propagates a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network"))
    await expect(searchLyrics({ q: "x" })).rejects.toThrow(/network/)
  })
})

describe("fetchLyricsVariants", () => {
  it("returns the variants array wrapped in an object", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 1,
              videoId: "v1",
              song: "S",
              artist: "A",
              format: "ttml",
              syncType: "richsync",
              score: 1,
              effectiveScore: 1.2,
              voteCount: 1,
              confidence: "low",
              hidden: false,
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await fetchLyricsVariants("v1")
    expect(result.variants).toHaveLength(1)
    expect(result.variants[0].id).toBe(1)
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/variants/v1")
  })

  it("url-encodes the videoId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    await fetchLyricsVariants("a/b c")
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/variants/a%2Fb%20c")
  })

  it("throws on a 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "missing" }), { status: 404 }),
    )
    await expect(fetchLyricsVariants("missing")).rejects.toThrow(/HTTP 404/)
  })
})

describe("fetchLyricsVariant", () => {
  it("returns the variant wrapped under variant", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 9,
            videoId: "v9",
            song: "S",
            artist: "A",
            format: "lrc",
            syncType: "linesync",
            score: 1,
            effectiveScore: 1.2,
            voteCount: 1,
            confidence: "low",
            hidden: false,
            lyrics: "lyrics body",
          },
        }),
        { status: 200 },
      ),
    )
    const result = await fetchLyricsVariant(9)
    expect(result.variant.id).toBe(9)
    expect(result.variant.lyrics).toBe("lyrics body")
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/9")
  })

  it("throws on a 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("err", { status: 500 }))
    await expect(fetchLyricsVariant(1)).rejects.toThrow(/HTTP 500/)
  })
})

describe("voteVariant", () => {
  it("posts the body with Bearer when signed-in", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
    await voteVariant(42, 1)
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/42/vote")
    const init = getCallInit(fetchSpy)
    expect(init?.method).toBe("POST")
    expect(JSON.parse(init?.body as string)).toEqual({ vote: 1 })
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${session.sessionToken}`)
    expect(headers["content-type"]).toBe("application/json")
  })

  it("rejects with AUTH_REQUIRED on 401", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "AUTH_REQUIRED" }), { status: 401 }),
    )
    await expect(voteVariant(42, 1)).rejects.toThrow(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  })

  it("rejects with RATE_LIMITED on 429", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "slow" }), { status: 429 }),
    )
    await expect(voteVariant(42, 1)).rejects.toThrow(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  })

  it("rejects with REQUEST_FAILED on other non-2xx", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }),
    )
    await expect(voteVariant(42, 1)).rejects.toThrow(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  })

  it("propagates a network failure", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network"))
    await expect(voteVariant(42, 1)).rejects.toThrow(/network/)
  })
})

describe("unvoteVariant", () => {
  it("issues a DELETE with Bearer", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
    await unvoteVariant(7)
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/7/vote")
    const init = getCallInit(fetchSpy)
    expect(init?.method).toBe("DELETE")
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${session.sessionToken}`)
  })

  it("rejects with AUTH_REQUIRED when the server returns 401", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "no" }), { status: 401 }),
    )
    await expect(unvoteVariant(7)).rejects.toThrow(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  })
})

describe("reportVariant", () => {
  it("posts the reason without details when none provided", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} }), { status: 201 }))
    await reportVariant(3, "spam")
    const init = getCallInit(fetchSpy)
    expect(init?.method).toBe("POST")
    expect(JSON.parse(init?.body as string)).toEqual({ reason: "spam" })
  })

  it("includes details when provided", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} }), { status: 201 }))
    await reportVariant(3, "bad_sync", "off by 2s")
    const init = getCallInit(fetchSpy)
    expect(JSON.parse(init?.body as string)).toEqual({ reason: "bad_sync", details: "off by 2s" })
    expect(getCallUrl(fetchSpy)).toBe("/lyrics/3/report")
  })

  it("rejects with AUTH_REQUIRED on 401", async () => {
    loadStoredSessionMock.mockReturnValue(null)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "no" }), { status: 401 }),
    )
    await expect(reportVariant(3, "spam")).rejects.toThrow(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  })

  it("rejects with REQUEST_FAILED on 500", async () => {
    loadStoredSessionMock.mockReturnValue(session)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }),
    )
    await expect(reportVariant(3, "spam")).rejects.toThrow(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  })
})

describe("fetchQueue", () => {
  it("sends an empty cursor and limit when no cursor is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              rank: 1,
              videoId: "v1",
              song: "S",
              artist: "A",
              thumbnailUrl: null,
              demand: 5,
              requestCount: 5,
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    )
    const result = await fetchQueue()
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
    const url = getCallUrl(fetchSpy)
    expect(url).toBe("/leaderboard/songs?cursor=&limit=50")
  })

  it("includes the cursor and limit when a cursor is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          nextCursor: "abc",
        }),
        { status: 200 },
      ),
    )
    const result = await fetchQueue({ cursor: "page2" })
    expect(result.nextCursor).toBe("abc")
    const url = getCallUrl(fetchSpy)
    expect(url).toContain("cursor=page2")
    expect(url).toContain("limit=50")
  })

  it("forwards the abort signal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [], nextCursor: null }), { status: 200 }),
      )
    const controller = new AbortController()
    await fetchQueue({ signal: controller.signal })
    expect(getCallInit(fetchSpy)?.signal).toBe(controller.signal)
  })

  it("defaults nextCursor to null when the server omits it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    )
    const result = await fetchQueue()
    expect(result.nextCursor).toBeNull()
  })

  it("throws on a 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "INVALID_CURSOR" }), { status: 400 }),
    )
    await expect(fetchQueue({ cursor: "bad" })).rejects.toThrow(/INVALID_CURSOR/)
  })

  it("throws on a 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 }),
    )
    await expect(fetchQueue()).rejects.toThrow()
  })
})
