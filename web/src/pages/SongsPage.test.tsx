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
      <AuthProvider>
        <SongsPage />
      </AuthProvider>
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
  it("renders both sections with rows from the API", async () => {
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
    expect(screen.getByText("Fixme Song")).toBeTruthy()
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
    expect(screen.getByText(/Reports below the threshold/i)).toBeTruthy()
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

  it("does not render a 'See all' link in the Needs Fixing header", async () => {
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
    await waitFor(() => expect(screen.getByText("Nothing flagged")).toBeTruthy())
    expect(screen.queryByRole("link", { name: /needs fixing/i })).toBeNull()
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
    expect(screen.getByText(/Report it from Better Lyrics/i)).toBeTruthy()
  })
})
