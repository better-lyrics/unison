import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { SongLeaderboardEntry } from "@/lib/types"
import { SongRow } from "./SongRow"

afterEach(() => cleanup())

const mostWantedEntry: SongLeaderboardEntry = {
  videoId: "vid-mw",
  song: "Midnight City",
  artist: "M83",
  thumbnailUrl: "https://example.com/thumb.jpg",
  demand: 123,
  requestCount: 7,
  section: "most_wanted",
  rank: 1,
}

const needsFixingEntry: SongLeaderboardEntry = {
  videoId: "vid-nf",
  song: "Outro",
  artist: "M83",
  thumbnailUrl: null,
  demand: 0,
  requestCount: 42,
  section: "needs_fixing",
  rank: 2,
}

function renderRow(entry: SongLeaderboardEntry) {
  return render(
    <ul>
      <SongRow entry={entry} />
    </ul>,
  )
}

describe("SongRow", () => {
  it("renders rank, song, artist for the entry", () => {
    renderRow(mostWantedEntry)
    expect(screen.getByText("#1")).toBeTruthy()
    expect(screen.getByText("Midnight City")).toBeTruthy()
    expect(screen.getByText("M83")).toBeTruthy()
  })

  it("renders the demand metric and 'demand' label for most_wanted rows", () => {
    renderRow(mostWantedEntry)
    expect(screen.getByText("123")).toBeTruthy()
    expect(screen.getByText("demand")).toBeTruthy()
  })

  it("renders the requestCount metric and 'reports' label for needs_fixing rows", () => {
    renderRow(needsFixingEntry)
    expect(screen.getByText("42")).toBeTruthy()
    expect(screen.getByText("reports")).toBeTruthy()
  })

  it("renders the thumbnail when thumbnailUrl is present", () => {
    const { container } = renderRow(mostWantedEntry)
    const img = container.querySelector("img")
    expect(img).toBeTruthy()
    expect(img?.getAttribute("src")).toBe("https://example.com/thumb.jpg")
  })

  it("falls back to a placeholder icon when thumbnailUrl is null", () => {
    const { container } = renderRow(needsFixingEntry)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("links the card body to YouTube Music in a new tab", () => {
    renderRow(mostWantedEntry)
    const ytmLink = screen.getByRole("link", { name: /Open .* in YouTube Music/i })
    expect(ytmLink.getAttribute("href")).toBe("https://music.youtube.com/watch?v=vid-mw")
    expect(ytmLink.getAttribute("target")).toBe("_blank")
    expect(ytmLink.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("renders a single link per row pointing to YouTube Music", () => {
    renderRow(mostWantedEntry)
    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute("href")).toBe("https://music.youtube.com/watch?v=vid-mw")
  })
})
