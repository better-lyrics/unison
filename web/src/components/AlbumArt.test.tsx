import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AlbumArt } from "@/components/AlbumArt"

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AlbumArt", () => {
  it("renders the resolved cover", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: "https://art/x=w544-h544" } })),
    )
    const { container } = render(wrap(<AlbumArt videoId="dQw4w9WgXcQ" />))
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://art/x=w544-h544")
  })

  describe("fallback", () => {
    it("keeps the music-note placeholder when there is no square art", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: null } })))
      const { container } = render(wrap(<AlbumArt videoId="dQw4w9WgXcQ" />))
      await waitFor(() => expect(container.querySelector("svg")).not.toBeNull())
      expect(container.querySelector("img")).toBeNull()
    })
  })
})
