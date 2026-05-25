import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { UserProfileView } from "./UserProfileView"

const keyId = "u".repeat(64)

function renderView(title?: string) {
  return render(
    <MemoryRouter>
      <UserProfileView keyId={keyId} title={title} />
    </MemoryRouter>,
  )
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
  it("renders ranked stats, last vote, and submissions list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: true,
                  keyId,
                  displayName: "AlphaUser",
                  reputation: 1.2,
                  score: 7.4,
                  submissionCount: 3,
                  totalUpvotes: 11,
                  rank: 12,
                  lastVoteAt: Math.floor(Date.now() / 1000) - 3600,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${keyId}/submissions`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
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
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView("Profile")

    await waitFor(() => expect(screen.getByText("AlphaUser")).toBeTruthy())
    expect(screen.getByText(/#12/)).toBeTruthy()
    expect(screen.getByText("7.4")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.getByText("11")).toBeTruthy()
    expect(screen.getByText(/last voted/i)).toBeTruthy()

    await waitFor(() => expect(screen.getByText("First Song")).toBeTruthy())
    expect(screen.getByText("Hidden Song")).toBeTruthy()
    expect(screen.getByText(/^hidden$/i)).toBeTruthy()
  })

  it("renders the unranked empty state and 'has not voted' line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: false,
                  keyId,
                  displayName: "QuietUser",
                  lastVoteAt: null,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${keyId}/submissions`) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()

    await waitFor(() => expect(screen.getByText("QuietUser")).toBeTruthy())
    expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy()
    expect(screen.getByText(/hasn't voted yet/i)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/no submissions yet/i)).toBeTruthy())
  })

  it("copies the key id to the clipboard when the copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: false,
                  keyId,
                  displayName: "QuietUser",
                  lastVoteAt: null,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${keyId}/submissions`) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderView()
    await waitFor(() => expect(screen.getByText("QuietUser")).toBeTruthy())
    const button = screen.getByRole("button", { name: /copy key id/i })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(writeText).toHaveBeenCalledWith(keyId)
  })

  it("loads more submissions when the load more button is clicked", async () => {
    const now = Math.floor(Date.now() / 1000)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === `/leaderboard/users/${keyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: { ranked: false, keyId, displayName: "U", lastVoteAt: null },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${keyId}/submissions`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
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
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${keyId}/submissions?cursor=${now - 100}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
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
                },
              }),
              { status: 200 },
            ),
          )
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
