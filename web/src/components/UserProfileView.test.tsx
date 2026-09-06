import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { UserProfileView } from "./UserProfileView"

const keyId = "u".repeat(64)

function renderView() {
  return render(
    <MemoryRouter>
      <UserProfileView keyId={keyId} />
    </MemoryRouter>,
  )
}

function ok(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }))
}

const catalogue = {
  badges: [
    {
      key: "most-loved",
      name: "Most Loved",
      description: "desc",
      category: "acclaim",
      kind: "medal",
      image: { color: "/badge-art/most-loved.svg", mono: "/badge-art/most-loved_mono.svg" },
    },
  ],
  display: { inlineGlyphs: 1, featuredMax: 5, rarityThreshold: 0.1, categoryOrder: ["acclaim"] },
}

beforeEach(() => {
  clearAsyncDataCache()
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("UserProfileView", () => {
  it("renders the name, rank pill, stat values, and submissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "AlphaUser",
            reputation: 1.2,
            score: 7.4,
            submissionCount: 3,
            totalUpvotes: 11,
            rank: 12,
            lastVoteAt: Math.floor(Date.now() / 1000) - 3600,
          })
        }
        if (url === `/users/${keyId}/submissions`) {
          return ok({
            submissions: [
              {
                id: 1,
                videoId: "v1",
                song: "First Song",
                artist: "Artist A",
                duration: 200,
                format: "ttml",
                syncType: "richsync",
                effectiveScore: 4.4,
                voteCount: 7,
                confidence: "medium",
                createdAt: Math.floor(Date.now() / 1000) - 86400,
                hidden: false,
              },
              {
                id: 2,
                videoId: "v2",
                song: "Hidden Song",
                artist: "Artist B",
                duration: 180,
                format: "lrc",
                syncType: "linesync",
                effectiveScore: 1.1,
                voteCount: 1,
                confidence: "low",
                createdAt: Math.floor(Date.now() / 1000) - 2 * 86400,
                hidden: true,
              },
            ],
          })
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()

    await waitFor(() => expect(screen.getByText("AlphaUser")).toBeTruthy())
    expect(screen.getByText("Rank #12")).toBeTruthy()
    expect(screen.getByTestId("stat-score").textContent).toContain("7.4")
    expect(screen.getByTestId("stat-submissions").textContent).toContain("3")
    expect(screen.getByTestId("stat-upvotes").textContent).toContain("11")

    await waitFor(() => expect(screen.getByText("First Song")).toBeTruthy())
    expect(screen.getByText("Hidden Song")).toBeTruthy()
    expect(screen.getByText(/^hidden$/i)).toBeTruthy()
  })

  it("shows a gold rank pill for a rank-1 curator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "TopUser",
            reputation: 1.6,
            score: 99.9,
            submissionCount: 50,
            totalUpvotes: 200,
            rank: 1,
            lastVoteAt: Math.floor(Date.now() / 1000) - 60,
          })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("TopUser")).toBeTruthy())
    expect(screen.getByText("Rank #1")).toBeTruthy()
  })

  it("renders the unranked empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "QuietUser", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("QuietUser")).toBeTruthy())
    expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/no submissions yet/i)).toBeTruthy())
  })

  it("shares the /u profile link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "QuietUser", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("QuietUser")).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share/i }))
    })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/u/quietuser"))
  })

  it("renders tier, level line, expertise, and badges from gamification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "AlphaUser",
            reputation: 1.2,
            score: 7.4,
            submissionCount: 3,
            totalUpvotes: 11,
            rank: 1,
            lastVoteAt: null,
          })
        }
        if (url === `/users/${keyId}/badges`) {
          return ok({
            keyId,
            level: 8,
            xp: 3200,
            xpForNext: 4000,
            tier: "legendary",
            tierRank: 1,
            featured: ["most-loved"],
            counts: { earned: 1, total: 1 },
            topExpertise: [{ scope: "artist", name: "Radiohead", rank: 2 }],
            badges: [{ key: "most-loved", earned: true, featured: true }],
          })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        if (url === "/badges") return ok(catalogue)
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("Legendary")).toBeTruthy())
    expect(screen.getByText(/XP to Level 9/)).toBeTruthy()
    expect(screen.getByText("Radiohead")).toBeTruthy()
    // The badge wall depends on the separate catalogue fetch, so await it rather than assuming order.
    await waitFor(() => expect(screen.getAllByText("Most Loved").length).toBeGreaterThan(0))
  })

  it("renders the community account with a Community chip and no rank pill", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "Community",
            community: true,
            reputation: 2,
            score: 99,
            submissionCount: 500,
            totalUpvotes: 9,
            rank: 0,
            lastVoteAt: null,
          })
        }
        if (url === `/users/${keyId}/badges`) {
          return ok({
            keyId,
            level: 1,
            xp: 0,
            xpForNext: 50,
            tier: null,
            tierRank: null,
            featured: ["community"],
            counts: { earned: 1, total: 1 },
            badges: [{ key: "community", earned: true, featured: true }],
          })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        if (url === "/badges") {
          return ok({
            badges: [
              {
                key: "community",
                name: "Community",
                description: "shared",
                category: "special",
                kind: "special",
                secret: true,
                image: { color: "/badge-art/community.svg", mono: "/badge-art/community_mono.svg" },
              },
            ],
            display: { inlineGlyphs: 1, featuredMax: 5, rarityThreshold: 0.1, categoryOrder: ["special"] },
          })
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("Community account")).toBeTruthy())
    expect(screen.queryByText(/Rank #/)).toBeNull()
  })

  it("does not crash for a user with no tier and no earned badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "QuietUser", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/badges`) {
          return ok({
            keyId,
            level: 3,
            xp: 200,
            xpForNext: 350,
            tier: null,
            tierRank: null,
            featured: [],
            counts: { earned: 0, total: 1 },
            badges: [],
          })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        if (url === "/badges") return ok(catalogue)
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("QuietUser")).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/XP to Level 4/)).toBeTruthy())
    expect(screen.queryByText("Legendary")).toBeNull()
  })

  it("loads more submissions when the load more button is clicked", async () => {
    const now = Math.floor(Date.now() / 1000)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "U", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/submissions`) {
          return ok({
            submissions: [
              {
                id: 1,
                videoId: "v1",
                song: "Song One",
                artist: "Artist",
                duration: 200,
                format: "ttml",
                syncType: "richsync",
                effectiveScore: 1,
                voteCount: 1,
                confidence: "low",
                createdAt: now - 100,
                hidden: false,
              },
            ],
            nextCursor: now - 100,
          })
        }
        if (url === `/users/${keyId}/submissions?cursor=${now - 100}`) {
          return ok({
            submissions: [
              {
                id: 2,
                videoId: "v2",
                song: "Song Two",
                artist: "Artist",
                duration: 200,
                format: "ttml",
                syncType: "richsync",
                effectiveScore: 1,
                voteCount: 1,
                confidence: "low",
                createdAt: now - 200,
                hidden: false,
              },
            ],
          })
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("Song One")).toBeTruthy())
    const loadMore = await screen.findByRole("button", { name: /load more/i })
    await act(async () => {
      fireEvent.click(loadMore)
    })
    await waitFor(() => expect(screen.getByText("Song Two")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull()
  })
})
