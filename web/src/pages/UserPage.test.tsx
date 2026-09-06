import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { UserPage } from "./UserPage"

const keyId = "a".repeat(64)

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/curator/:keyId" element={<UserPage />} />
        <Route path="/curator" element={<UserPage />} />
      </Routes>
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

describe("UserPage", () => {
  it("renders the profile for a ranked user from the route param", async () => {
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
                  displayName: "RouteUser",
                  reputation: 1.0,
                  score: 3.3,
                  submissionCount: 2,
                  totalUpvotes: 5,
                  rank: 4,
                  lastVoteAt: Math.floor(Date.now() / 1000) - 600,
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

    renderAt(`/curator/${keyId}`)
    await waitFor(() => expect(screen.getByText("RouteUser")).toBeTruthy())
    expect(screen.getByText(/#4/)).toBeTruthy()
  })

  it("renders the unranked empty state when the user is not on the leaderboard", async () => {
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
                  displayName: "UnrankedUser",
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

    renderAt(`/curator/${keyId}`)
    await waitFor(() => expect(screen.getByText("UnrankedUser")).toBeTruthy())
    expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy()
  })
})
