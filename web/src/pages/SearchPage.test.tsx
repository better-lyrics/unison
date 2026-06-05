import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SearchPage } from "./SearchPage"

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
}

function renderAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={createTestClient()}>
        <SearchPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SearchPage", () => {
  it("shows the hint empty state and does not fetch when there is no query", () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    renderAt(["/search"])
    expect(screen.getByText(/Type a song, artist, or lyric line/i)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("shows the hint empty state and does not fetch when q is one character", () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    renderAt(["/search?q=a"])
    expect(screen.getByText(/Type a song, artist, or lyric line/i)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("renders the loading placeholder while pending with a 2-char query", async () => {
    let resolve: (response: Response) => void = () => {}
    const pending = new Promise<Response>((r) => {
      resolve = r
    })
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending))
    const { container } = renderAt(["/search?q=lo"])
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeTruthy())
    resolve(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
  })

  it("renders rows when the search returns results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 1,
                videoId: "v1",
                song: "Result Song",
                artist: "Result Artist",
                duration: 240,
                format: "ttml",
                syncType: "richsync",
                score: 1,
                effectiveScore: 5.5,
                voteCount: 3,
                confidence: "medium",
              },
              {
                id: 2,
                videoId: "v2",
                song: "Second Song",
                artist: "Another Artist",
                duration: 180,
                format: "lrc",
                syncType: "linesync",
                score: 1,
                effectiveScore: 4.4,
                voteCount: 1,
                confidence: "low",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const { container } = renderAt(["/search?q=love"])
    await waitFor(() => expect(screen.getByText("Result Song")).toBeTruthy())
    expect(screen.getByText("Second Song")).toBeTruthy()
    expect(container.querySelectorAll("ul > li")).toHaveLength(2)
  })

  it("renders the no-matches empty state when results are empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })),
    )
    renderAt(["/search?q=zzzz"])
    await waitFor(() => expect(screen.getByText(/No matches/i)).toBeTruthy())
  })

  it("renders the error empty state when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "search broken" }), { status: 200 }),
      ),
    )
    renderAt(["/search?q=love"])
    await waitFor(() => expect(screen.getByText(/Could not load results/i)).toBeTruthy())
    expect(screen.getByText(/search broken/)).toBeTruthy()
  })

  it("fires the fetch when both song and artist are provided", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    renderAt(["/search?song=Cruel+Summer&artist=Taylor+Swift"])
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain("song=Cruel+Summer")
    expect(url).toContain("artist=Taylor+Swift")
  })

  it("does not fire the fetch when only one of song or artist is provided", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    renderAt(["/search?song=Cruel+Summer"])
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("links rows to /song/:videoId?variantId=:id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 99,
                videoId: "vid99",
                song: "Linked",
                artist: "Artist",
                duration: 100,
                format: "ttml",
                syncType: "richsync",
                score: 1,
                effectiveScore: 5,
                voteCount: 2,
                confidence: "medium",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    renderAt(["/search?q=link"])
    await waitFor(() => expect(screen.getByText("Linked")).toBeTruthy())
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("/song/vid99?variantId=99")
  })
})
