import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SongThumbnail } from "@/components/SongThumbnail"

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

describe("SongThumbnail", () => {
  it("renders the resolved cover art", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: "https://art/x=w544-h544" } })),
    )
    const { container } = render(wrap(<SongThumbnail videoId="dQw4w9WgXcQ" />))
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://art/x=w544-h544")
  })

  it("applies the passed className to the frame", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { artworkUrl: null } })))
    const { container } = render(wrap(<SongThumbnail videoId="v" className="size-11" />))
    expect(container.firstElementChild?.className).toContain("size-11")
    expect(container.firstElementChild?.className).toContain("rounded-md")
  })
})
