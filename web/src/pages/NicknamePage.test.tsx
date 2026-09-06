import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { NicknamePage } from "./NicknamePage"

const keyId = "a".repeat(64)

function ok(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }))
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
        if (url === "/leaderboard/users") {
          return ok({
            curators: [
              {
                keyId,
                displayName: "Aurora Wynter",
                reputation: 1.9,
                score: 312.4,
                submissionCount: 87,
                totalUpvotes: 540,
                rank: 1,
                discordLinked: true,
              },
            ],
          })
        }
        if (url === `/leaderboard/users/${keyId}`) {
          return ok({
            ranked: true,
            keyId,
            displayName: "Aurora Wynter",
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

  it("shows a not-found state for an unknown handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/leaderboard/users") return ok({ curators: [] })
        return Promise.reject(new Error(`unexpected url ${url}`))
      }),
    )

    renderAt("/u/ghost")
    await waitFor(() => expect(screen.getByText(/no curator found/i)).toBeTruthy())
  })
})
