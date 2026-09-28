import { AuthProvider } from "@/auth/AuthProvider"
import { NOW, OLA, bookmarkBy, councilData, editItem, queueItem, stubCouncilApi } from "@/test/council-fixtures"
import { fetchRouter } from "@/test/fetch-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CouncilNavLink } from "./CouncilNavLink"

function renderLink() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <CouncilNavLink className={() => "tab"} />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const committeeCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/committee/"))

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000)
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("CouncilNavLink", () => {
  it("links members to the dashboard with the count of open work", async () => {
    stubCouncilApi(
      councilData({
        queue: [queueItem({ id: 1 }), queueItem({ id: 2 }), queueItem({ id: 3, bookmark: bookmarkBy(OLA) })],
        edits: {
          items: [editItem({ revisionId: 9 })],
          thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 },
        },
      }),
    )
    renderLink()
    const link = await screen.findByRole("link", { name: "Council, 3 open items" })
    expect(link.getAttribute("href")).toBe("/council")
    expect(link.textContent).toBe("Council3")
  })

  it("hides the count when nothing is open", async () => {
    const router = stubCouncilApi(councilData(), { admin: true })
    renderLink()
    const link = await screen.findByRole("link")
    await waitFor(() => expect(committeeCalls(router.calls).length).toBeGreaterThan(0))
    expect(link.textContent).toBe("Council")
    expect(link.getAttribute("aria-label")).toBeNull()
  })

  describe("edge cases", () => {
    it("renders nothing for a signed-out visitor", () => {
      const router = fetchRouter([])
      vi.stubGlobal("fetch", router.fn)
      renderLink()
      expect(screen.queryByRole("link")).toBeNull()
      expect(router.calls).toEqual([])
    })

    it("renders nothing for a signed-in account outside the council and fetches no council data", async () => {
      const router = stubCouncilApi(councilData({ queue: [queueItem({ id: 1 })] }), null)
      renderLink()
      await waitFor(() => expect(router.calls.some((c) => c.url === "/auth/me")).toBe(true))
      expect(screen.queryByRole("link")).toBeNull()
      expect(committeeCalls(router.calls)).toEqual([])
    })

    it("counts an item whose bookmark has expired as open", async () => {
      const expired = { ...bookmarkBy(OLA), expiresAt: NOW - 1 }
      stubCouncilApi(councilData({ queue: [queueItem({ id: 1, bookmark: expired })] }))
      renderLink()
      expect(await screen.findByRole("link", { name: "Council, 1 open item" })).toBeTruthy()
    })
  })
})
