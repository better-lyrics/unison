import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
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
    const { container } = render(wrap(<AlbumArt videoId="dQw4w9WgXcQ" song="Paper Lanterns" artist="Halden" />))
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://art/x=w544-h544")
  })

  describe("fallback", () => {
    it("paints the sleeve when there is no square art", async () => {
      const fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: null } }))
      vi.stubGlobal("fetch", fetch)
      const { container } = render(wrap(<AlbumArt videoId="dQw4w9WgXcQ" song="Paper Lanterns" artist="Halden" />))
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(container.querySelector("img")).toBeNull()
      expect(container.firstElementChild?.tagName).toBe("DIV")
    })

    it("paints the sleeve when the cover fails to load", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: "https://art/x=w544-h544" } })),
      )
      const { container } = render(wrap(<AlbumArt videoId="dQw4w9WgXcQ" song="Paper Lanterns" artist="Halden" />))
      const img = await waitFor(() => {
        const found = container.querySelector("img")
        expect(found).not.toBeNull()
        return found as HTMLImageElement
      })
      fireEvent.error(img)
      expect(container.querySelector("img")).toBeNull()
      expect(container.firstElementChild?.tagName).toBe("DIV")
    })
  })
})
