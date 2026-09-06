import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { type StoredSession, saveStoredSession } from "@/lib/auth"
import { MePage } from "./MePage"

const ownKeyId = "k".repeat(64)

function HandleProbe() {
  const { nickname } = useParams<{ nickname: string }>()
  return <div data-testid="handle-probe">{nickname}</div>
}
const valid: StoredSession = {
  sessionToken: "tok",
  keyId: ownKeyId,
  displayName: "BrightVivaceRoll",
  expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MePage />
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

describe("MePage", () => {
  it("shows a sign-in prompt when signed-out", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeTruthy())
    expect(screen.getByText(/sign in with better lyrics from the header/i)).toBeTruthy()
  })

  it("does not render the NicknameEditor when signed-out", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeTruthy())
    expect(screen.queryByTestId("nickname-editor")).toBeNull()
  })

  it("renders the NicknameEditor when signed-in", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  expiresAt: valid.expiresAt,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: false,
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  lastVoteAt: null,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${ownKeyId}/submissions`) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await screen.findByTestId("nickname-editor")
  })

  it("renders identity and ranked stats when signed-in and ranked", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  expiresAt: valid.expiresAt,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: true,
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  reputation: 1.5,
                  score: 12.7,
                  submissionCount: 5,
                  totalUpvotes: 23,
                  rank: 7,
                  lastVoteAt: Math.floor(Date.now() / 1000) - 3600,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${ownKeyId}/submissions`) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    await waitFor(() => expect(screen.getByText("Rank #7")).toBeTruthy())
    expect(screen.getByTestId("stat-score").textContent).toContain("12.7")
    expect(screen.getByTestId("stat-submissions").textContent).toContain("5")
    expect(screen.getByTestId("stat-upvotes").textContent).toContain("23")
    expect(screen.getByRole("button", { name: /copy profile link/i })).toBeTruthy()
  })

  it("renders identity but no stats when signed-in and not ranked", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  expiresAt: valid.expiresAt,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: false,
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  lastVoteAt: null,
                },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/users/${ownKeyId}/submissions`) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { submissions: [] } }), { status: 200 }),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy())
  })

  it("redirects the signed-in owner to their canonical /u/<handle>", async () => {
    saveStoredSession(valid)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: { keyId: ownKeyId, displayName: valid.displayName, expiresAt: valid.expiresAt },
              }),
              { status: 200 },
            ),
          )
        }
        if (url === `/leaderboard/users/${ownKeyId}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  ranked: true,
                  keyId: ownKeyId,
                  displayName: valid.displayName,
                  handle: "brightvivaceroll",
                  reputation: 1.5,
                  score: 12.7,
                  submissionCount: 5,
                  totalUpvotes: 23,
                  rank: 7,
                  lastVoteAt: null,
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )
    render(
      <MemoryRouter initialEntries={["/me"]}>
        <AuthProvider>
          <Routes>
            <Route path="/me" element={<MePage />} />
            <Route path="/u/:nickname" element={<HandleProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId("handle-probe").textContent).toBe("brightvivaceroll"))
  })
})
