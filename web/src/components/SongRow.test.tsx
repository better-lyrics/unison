import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
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
    <MemoryRouter>
      <ul>
        <SongRow entry={entry} />
      </ul>
    </MemoryRouter>,
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

  it("renders a 'View details' link pointing to the internal lyrics route", () => {
    renderRow(mostWantedEntry)
    const detailsLink = screen.getByRole("link", { name: /View details for Midnight City by M83/i })
    expect(detailsLink.getAttribute("href")).toBe("/song/vid-mw")
    expect(detailsLink.textContent).toMatch(/View details/)
  })

  it("exposes both the YTM link and the View details link in tab order", () => {
    renderRow(mostWantedEntry)
    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute("href")).toBe("https://music.youtube.com/watch?v=vid-mw")
    expect(links[1].getAttribute("href")).toBe("/song/vid-mw")
  })

  it("focuses each link independently", () => {
    renderRow(mostWantedEntry)
    const [ytm, details] = screen.getAllByRole("link")
    ytm.focus()
    expect(document.activeElement).toBe(ytm)
    details.focus()
    expect(document.activeElement).toBe(details)
  })

  it("does not nest anchors", () => {
    renderRow(mostWantedEntry)
    const ytm = screen.getByRole("link", { name: /Open .* in YouTube Music/i })
    expect(ytm.querySelector("a")).toBeNull()
  })
})
