import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCuratorLeaderboard, fetchSongLeaderboard, fetchUserRank, fetchUserSubmissions } from "./api"

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
            nextCursor: 1699999999,
          },
        }),
        { status: 200 },
      ),
    )
    const data = await fetchUserSubmissions("k")
    expect(data.submissions).toHaveLength(1)
    expect(data.submissions[0].id).toBe(1)
    expect(data.nextCursor).toBe(1699999999)
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
    const data = await fetchUserSubmissions("k", 1699999999)
    expect(data.submissions).toEqual([])
    expect(data.nextCursor).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith("/users/k/submissions?cursor=1699999999")
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
