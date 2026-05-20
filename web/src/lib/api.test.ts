import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCuratorLeaderboard, fetchSongLeaderboard } from "./api"

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
