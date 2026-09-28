import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FeedEntry } from "@/lib/types"
import { SealedShelf } from "./SealedShelf"

function sealedEntry(i: number): FeedEntry {
  return {
    id: i,
    videoId: `vidSealed${String(i).padStart(2, "0")}`,
    song: `Sealed Song ${i}`,
    artist: `Artist ${i}`,
    syncType: "richsync",
    createdAt: 1_760_000_000,
    marks: [{ type: "seal", label: "BLCA", icon: "/badges/committee/image.svg", at: 1_760_000_000 - i }],
  }
}

function stubFetch(feed: (url: string) => Promise<Response>) {
  const spy = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith("/feed")) return feed(url)
    if (url.startsWith("/artwork")) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { artworkUrl: null } })))
    }
    return Promise.reject(new Error(`unexpected url ${url}`))
  })
  vi.stubGlobal("fetch", spy)
  return spy
}

const page = (items: FeedEntry[], status = 200) =>
  Promise.resolve(new Response(JSON.stringify({ success: status === 200, data: items, error: "boom" }), { status }))

function renderShelf() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SealedShelf />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SealedShelf", () => {
  describe("happy path", () => {
    it("asks for the 12 most recently sealed lyrics", async () => {
      const spy = stubFetch(() => page([sealedEntry(1)]))
      renderShelf()
      await waitFor(() => expect(screen.getByText("Sealed Song 1")).toBeTruthy())
      expect(spy.mock.calls.map((c) => c[0])).toContain("/feed?sealed=1&sort=recently-sealed&limit=12")
    })

    it("shows the title, one tile per entry, and See all to /sealed", async () => {
      stubFetch(() => page([sealedEntry(1), sealedEntry(2)]))
      renderShelf()
      await waitFor(() => expect(screen.getByText("Sealed Song 2")).toBeTruthy())
      expect(screen.getByRole("heading", { name: "Sealed by the Council" })).toBeTruthy()
      expect(screen.getByText("Lyrics the Better Lyrics Council approved")).toBeTruthy()
      expect(screen.getAllByRole("link", { name: /^Sealed Song \d by/ })).toHaveLength(2)
      expect(screen.getByRole("link", { name: "See all sealed lyrics" }).getAttribute("href")).toBe("/sealed")
    })
  })

  describe("edge cases", () => {
    it("shows the skeleton while the first page loads", () => {
      stubFetch(() => new Promise(() => {}))
      const { container } = renderShelf()
      expect(screen.getByRole("heading", { name: "Sealed by the Council" })).toBeTruthy()
      expect(container.querySelectorAll('[aria-hidden="true"].w-\\[148px\\]').length).toBe(7)
    })

    it("renders nothing when nothing is sealed", async () => {
      const spy = stubFetch(() => page([]))
      const { container } = renderShelf()
      await waitFor(() => expect(spy).toHaveBeenCalled())
      await waitFor(() => expect(container.innerHTML).toBe(""))
    })
  })

  describe("error paths", () => {
    it("renders nothing when the sealed feed fails", async () => {
      stubFetch(() => page([], 500))
      const { container } = renderShelf()
      await waitFor(() => expect(container.innerHTML).toBe(""))
    })
  })

  describe("regressions", () => {
    it("regression: the loading row never scrolls sideways", () => {
      stubFetch(() => new Promise(() => {}))
      const { container } = renderShelf()
      const row = container.querySelector('[data-testid="sealed-shelf-row"]')
      expect(row?.className).toContain("overflow-hidden")
      expect(row?.className).not.toContain("overflow-x-auto")
    })

    it("regression: the loaded row scrolls without a visible browser scrollbar or bottom gutter", async () => {
      stubFetch(() => page([sealedEntry(1)]))
      const { container } = renderShelf()
      await waitFor(() => expect(screen.getByText("Sealed Song 1")).toBeTruthy())
      const row = container.querySelector('[data-testid="sealed-shelf-row"]')
      expect(row?.className).toContain("overflow-x-auto")
      expect(row?.className).toContain("[scrollbar-width:none]")
      expect(row?.className).toContain("[&::-webkit-scrollbar]:hidden")
      expect(row?.className).not.toMatch(/\bpb-/)
    })
  })
})
