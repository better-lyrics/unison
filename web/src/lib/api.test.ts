import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCuratorLeaderboard, fetchMyCuratorRank, fetchSongLeaderboard } from "./api"

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, ok = true): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 }),
  )
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

describe("fetchMyCuratorRank", () => {
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
          },
        }),
        { status: 200 },
      ),
    )
    const data = await fetchMyCuratorRank("k")
    expect(data.ranked).toBe(true)
    if (data.ranked) expect(data.rank).toBe(47)
    expect(fetchSpy).toHaveBeenCalledWith("/leaderboard/users/k")
  })

  it("returns ranked=false when the user is not on the leaderboard", async () => {
    mockFetchOnce({ success: true, data: { ranked: false } })
    const data = await fetchMyCuratorRank("k")
    expect(data.ranked).toBe(false)
  })

  it("url-encodes the keyId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ranked: false } }), { status: 200 }),
      )
    await fetchMyCuratorRank("a/b c")
    expect(fetchSpy).toHaveBeenCalledWith("/leaderboard/users/a%2Fb%20c")
  })

  it("throws when the envelope is not successful", async () => {
    mockFetchOnce({ success: false, error: "nope" })
    await expect(fetchMyCuratorRank("k")).rejects.toThrow(/nope/)
  })
})
