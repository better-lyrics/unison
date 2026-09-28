import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { saveStoredSession, type StoredSession } from "@/lib/auth"
import { SongsPage } from "./SongsPage"

const ownKeyId = "k".repeat(64)
const valid: StoredSession = {
  sessionToken: "tok",
  keyId: ownKeyId,
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthProvider>
          <SongsPage />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearAsyncDataCache()
  localStorage.clear()
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  clearAsyncDataCache()
})

describe("SongsPage", () => {
  it("renders Most Wanted rows and never a Needs Fixing board, even when the API returns entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                mostWanted: [
                  {
                    videoId: "vid1",
                    song: "Wanted Song",
                    artist: "Wanted Artist",
                    thumbnailUrl: null,
                    demand: 42,
                    requestCount: 7,
                    section: "most_wanted",
                    rank: 1,
                  },
                ],
                needsFixing: [
                  {
                    videoId: "vid2",
                    song: "Fixme Song",
                    artist: "Fixme Artist",
                    thumbnailUrl: null,
                    demand: 0,
                    requestCount: 5,
                    section: "needs_fixing",
                    rank: 1,
                  },
                ],
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Wanted Song")).toBeTruthy())
    expect(screen.queryByText("Fixme Song")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Needs Fixing" })).toBeNull()
  })

  it("shows signed-out empty states when sections are empty and signed-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { mostWanted: [], needsFixing: [] },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Nothing wanted right now")).toBeTruthy())
  })

  it("renders a 'See all' link in the Most Wanted header pointing to /queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { mostWanted: [], needsFixing: [] },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Nothing wanted right now")).toBeTruthy())
    const seeAll = screen.getByRole("link", { name: /See all most wanted/i })
    expect(seeAll.getAttribute("href")).toBe("/queue")
  })

  it("caps the Most Wanted preview at 10 rows; the rest sit behind 'See all'", async () => {
    const mostWanted = Array.from({ length: 25 }, (_, i) => ({
      videoId: `vid${i + 1}`,
      song: `Song ${i + 1}`,
      artist: `Artist ${i + 1}`,
      thumbnailUrl: null,
      demand: 100 - i,
      requestCount: 25 - i,
      section: "most_wanted" as const,
      rank: i + 1,
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { mostWanted, needsFixing: [] },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Song 1")).toBeTruthy())
    expect(screen.getByText("Song 10")).toBeTruthy()
    expect(screen.queryByText("Song 11")).toBeNull()
    expect(screen.queryByText("Song 25")).toBeNull()
    const seeAll = screen.getByRole("link", { name: /See all most wanted/i })
    expect(seeAll.getAttribute("href")).toBe("/queue")
  })

  it("renders exactly one 'See all' link, for Most Wanted, when nothing is sealed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { mostWanted: [], needsFixing: [] },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Nothing wanted right now")).toBeTruthy())
    const allLinks = screen.queryAllByRole("link", { name: /See all/i })
    expect(allLinks).toHaveLength(1)
    expect(allLinks[0].getAttribute("href")).toBe("/queue")
  })

  it("shows signed-in empty states when signed-in and sections are empty", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
            }),
          )
        }
        if (url === "/leaderboard/songs") {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: { mostWanted: [], needsFixing: [] },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText("Nothing requested right now")).toBeTruthy())
    expect(screen.getByText(/Request lyrics from Better Lyrics/i)).toBeTruthy()
  })

  describe("sealed shelf", () => {
    const emptyBoard = () => jsonResponse({ success: true, data: { mostWanted: [], needsFixing: [] } })
    const sealed = {
      id: 5,
      videoId: "HsBfV2A5dUY",
      song: "Sealed Grace",
      artist: "Traditional",
      syncType: "richsync",
      createdAt: 1_760_000_000,
      marks: [{ type: "seal", label: "BLCA", icon: "/badges/committee/image.svg", at: 1_760_000_000 }],
    }

    it("shows the shelf above Most Wanted", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (url === "/leaderboard/songs") return Promise.resolve(emptyBoard())
          if (url.startsWith("/feed")) return Promise.resolve(jsonResponse({ success: true, data: [sealed] }))
          if (url.startsWith("/artwork"))
            return Promise.resolve(jsonResponse({ success: true, data: { artworkUrl: null } }))
          return Promise.reject(new Error(`unexpected url ${url}`))
        }),
      )
      renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Grace")).toBeTruthy())
      const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
      expect(headings.indexOf("Sealed by the Council")).toBeLessThan(headings.indexOf("Most Wanted"))
    })

    it("shows the shelf skeleton while the page loads", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => new Promise(() => {})),
      )
      renderPage()
      expect(screen.getByRole("heading", { name: "Sealed by the Council" })).toBeTruthy()
      expect(screen.getByRole("heading", { name: "Most Wanted" })).toBeTruthy()
      expect(screen.queryByRole("heading", { name: "Needs Fixing" })).toBeNull()
    })

    it("keeps the shelf when the leaderboard fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (url === "/leaderboard/songs") return Promise.resolve(jsonResponse({ success: false, error: "boom" }, 500))
          if (url.startsWith("/feed")) return Promise.resolve(jsonResponse({ success: true, data: [sealed] }))
          if (url.startsWith("/artwork"))
            return Promise.resolve(jsonResponse({ success: true, data: { artworkUrl: null } }))
          return Promise.reject(new Error(`unexpected url ${url}`))
        }),
      )
      renderPage()
      await waitFor(() => expect(screen.getByText("Could not load leaderboard")).toBeTruthy())
      await waitFor(() => expect(screen.getByText("Sealed Grace")).toBeTruthy())
    })

    it("regression: a failed sealed feed never hides Most Wanted", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (url === "/leaderboard/songs") return Promise.resolve(emptyBoard())
          if (url.startsWith("/feed")) return Promise.resolve(jsonResponse({ success: false, error: "boom" }, 500))
          return Promise.reject(new Error(`unexpected url ${url}`))
        }),
      )
      renderPage()
      await waitFor(() => expect(screen.getByText("Nothing wanted right now")).toBeTruthy())
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Sealed by the Council" })).toBeNull())
    })
  })
})
