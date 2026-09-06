import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionContext } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { NicknamePage } from "./NicknamePage"

const keyId = "a".repeat(64)

const ownerSession = {
  status: "signed-in",
  extensionAvailable: true,
  identity: { keyId, displayName: "Aurora Wynter", expiresAt: Math.floor(Date.now() / 1000) + 1000 },
  signOut: () => {},
  updateDisplayName: () => {},
} as const

function ok(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }))
}

function notFound(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ success: false, error: "not found" }), { status: 404 }))
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/u/:nickname" element={<NicknamePage />} />
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

describe("NicknamePage", () => {
  it("resolves a handle to the matching curator profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/users/by-handle/aurorawynter") return ok({ keyId })
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "Aurora Wynter",
            handle: "aurorawynter",
            reputation: 1.9,
            score: 312.4,
            submissionCount: 87,
            totalUpvotes: 540,
            rank: 1,
            lastVoteAt: null,
          })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderAt("/u/aurorawynter")
    await waitFor(() => expect(screen.getByText("Aurora Wynter")).toBeTruthy())
    expect(screen.getByText("@aurorawynter")).toBeTruthy()
  })

  it("resolves a mixed-case handle via the lowercased lookup", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/users/by-handle/AuroraWynter") return ok({ keyId })
      if (url === `/leaderboard/users/${keyId}`) {
        return ok({ ranked: false, keyId, displayName: "Aurora Wynter", handle: "aurorawynter", lastVoteAt: null })
      }
      if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
      return Promise.reject(new Error(`unexpected url ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    renderAt("/u/AuroraWynter")
    await waitFor(() => expect(screen.getByText("Aurora Wynter")).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith("/users/by-handle/AuroraWynter")
  })

  it("shows the owner controls when the signed-in viewer owns the resolved profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/users/by-handle/aurorawynter") return ok({ keyId })
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "Aurora Wynter", handle: "aurorawynter", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    render(
      <SessionContext.Provider value={ownerSession}>
        <MemoryRouter initialEntries={["/u/aurorawynter"]}>
          <Routes>
            <Route path="/u/:nickname" element={<NicknamePage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>,
    )
    await waitFor(() => expect(screen.getByText("Aurora Wynter")).toBeTruthy())
    expect(screen.getByTestId("nickname-editor")).toBeTruthy()
  })

  it("hides the owner controls for a non-owner viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/users/by-handle/aurorawynter") return ok({ keyId })
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({ ranked: false, keyId, displayName: "Aurora Wynter", handle: "aurorawynter", lastVoteAt: null })
        }
        if (url === `/users/${keyId}/submissions`) return ok({ submissions: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderAt("/u/aurorawynter")
    await waitFor(() => expect(screen.getByText("Aurora Wynter")).toBeTruthy())
    expect(screen.queryByTestId("nickname-editor")).toBeNull()
  })

  it("shows a not-found state for an unknown handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/users/by-handle/ghost") return notFound()
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderAt("/u/ghost")
    await waitFor(() => expect(screen.getByText(/no curator found/i)).toBeTruthy())
  })
})
