import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FeedEntry } from "@/lib/types"
import { SealedPage } from "./SealedPage"

function sealedEntry(i: number, overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: i,
    videoId: `vidSealed${String(i).padStart(2, "0")}`,
    song: `Sealed Song ${i}`,
    artist: `Artist ${i}`,
    syncType: "richsync",
    createdAt: 1_760_000_000,
    marks: [{ type: "seal", label: "BLCA", icon: "/badges/committee/image.svg", at: 1_760_000_000 - i }],
    ...overrides,
  }
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function stubFeed(handler: (url: string) => Promise<Response>) {
  const spy = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith("/feed")) return handler(url)
    if (url.startsWith("/artwork")) return json({ success: true, data: { artworkUrl: null } })
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
  vi.stubGlobal("fetch", spy)
  return spy
}

const feedCalls = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map((c) => String(c[0])).filter((url) => url.startsWith("/feed"))

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderPage(path = "/sealed") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="/sealed"
            element={
              <>
                <SealedPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SealedPage", () => {
  describe("happy path", () => {
    it("loads the most recently sealed lyrics by default", async () => {
      const spy = stubFeed(() => json({ success: true, data: [sealedEntry(1), sealedEntry(2)] }))
      renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Song 2")).toBeTruthy())
      expect(feedCalls(spy)).toEqual(["/feed?sealed=1&sort=recently-sealed&limit=24"])
      expect(screen.getByRole("heading", { name: "Sealed lyrics", level: 1 })).toBeTruthy()
      expect(screen.getByText("2 sealed")).toBeTruthy()
    })

    it("links How to submit to the docs", async () => {
      stubFeed(() => json({ success: true, data: [] }))
      renderPage()
      expect(screen.getByRole("link", { name: "How to submit" }).getAttribute("href")).toBe("/docs")
    })

    it("writes the sync filter to the URL and refetches", async () => {
      const spy = stubFeed(() => json({ success: true, data: [sealedEntry(1)] }))
      renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Song 1")).toBeTruthy())
      fireEvent.click(screen.getByRole("button", { name: "Word synced" }))
      await waitFor(() =>
        expect(feedCalls(spy)).toContain("/feed?sealed=1&sort=recently-sealed&limit=24&syncType=richsync"),
      )
      expect(screen.getByTestId("location").textContent).toBe("?sync=richsync")
    })

    it("writes the sort to the URL and refetches", async () => {
      const spy = stubFeed(() => json({ success: true, data: [sealedEntry(1)] }))
      renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Song 1")).toBeTruthy())
      fireEvent.click(screen.getByRole("button", { name: "Top rated" }))
      await waitFor(() => expect(feedCalls(spy)).toContain("/feed?sealed=1&sort=top-rated&limit=24"))
      expect(screen.getByTestId("location").textContent).toBe("?sort=top-rated")
    })

    it("restores both filters from the URL", async () => {
      const spy = stubFeed(() => json({ success: true, data: [] }))
      renderPage("/sealed?sort=top-rated&sync=linesync")
      await waitFor(() => expect(feedCalls(spy)).toEqual(["/feed?sealed=1&sort=top-rated&limit=24&syncType=linesync"]))
      expect(screen.getByRole("button", { name: "Top rated" }).getAttribute("aria-pressed")).toBe("true")
      expect(screen.getByRole("button", { name: "Line synced" }).getAttribute("aria-pressed")).toBe("true")
    })

    it("loads the next page on Load more and appends it", async () => {
      const first = Array.from({ length: 24 }, (_, i) => sealedEntry(i + 1))
      const spy = stubFeed((url) =>
        url.includes("cursor=24")
          ? json({ success: true, data: [sealedEntry(25)] })
          : json({ success: true, data: first, nextCursor: 24 }),
      )
      renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Song 24")).toBeTruthy())
      expect(screen.getByText("24+ sealed")).toBeTruthy()
      fireEvent.click(screen.getByRole("button", { name: "Load more" }))
      await waitFor(() => expect(screen.getByText("Sealed Song 25")).toBeTruthy())
      expect(feedCalls(spy)).toContain("/feed?sealed=1&sort=recently-sealed&limit=24&cursor=24")
      expect(screen.getByText("Sealed Song 1")).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
      expect(screen.getByText("25 sealed")).toBeTruthy()
    })
  })

  describe("edge cases", () => {
    it("shows the intro, filters and skeleton cards while loading", () => {
      stubFeed(() => new Promise(() => {}))
      const { container } = renderPage()
      expect(screen.getByRole("heading", { name: "Sealed lyrics" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "All" })).toBeTruthy()
      const grid = container.querySelector('[data-testid="sealed-grid"]')
      expect(grid?.children).toHaveLength(10)
      expect(grid?.querySelector("a")).toBeNull()
    })

    it("shows an empty state when nothing is sealed", async () => {
      stubFeed(() => json({ success: true, data: [] }))
      renderPage()
      await waitFor(() => expect(screen.getByText("Nothing sealed yet")).toBeTruthy())
    })

    it("falls back to the defaults for unknown URL values", async () => {
      const spy = stubFeed(() => json({ success: true, data: [] }))
      renderPage("/sealed?sort=x&sync=plain")
      await waitFor(() => expect(feedCalls(spy)).toEqual(["/feed?sealed=1&sort=recently-sealed&limit=24"]))
      expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")
    })

    it("removes the param when a filter goes back to its default", async () => {
      stubFeed(() => json({ success: true, data: [] }))
      renderPage("/sealed?sync=richsync")
      fireEvent.click(screen.getByRole("button", { name: "All" }))
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(""))
    })
  })

  describe("error paths", () => {
    it("shows the error message when the feed fails", async () => {
      stubFeed(() => json({ success: false, error: "database is down" }, 500))
      renderPage()
      await waitFor(() => expect(screen.getByText("Could not load sealed lyrics")).toBeTruthy())
      expect(screen.getByText("database is down")).toBeTruthy()
    })
  })

  describe("invariants", () => {
    it("every card links to its song page", async () => {
      stubFeed(() => json({ success: true, data: [sealedEntry(1), sealedEntry(2)] }))
      const { container } = renderPage()
      await waitFor(() => expect(screen.getByText("Sealed Song 2")).toBeTruthy())
      const hrefs = [...container.querySelectorAll('[data-testid="sealed-grid"] a')].map((a) => a.getAttribute("href"))
      expect(hrefs).toEqual(["/song/vidSealed01", "/song/vidSealed02"])
    })
  })
})
