import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import type { LyricsSearchHit } from "@/lib/types"
import { SearchResultRow } from "./SearchResultRow"

afterEach(() => cleanup())

const baseHit: LyricsSearchHit = {
  id: 42,
  videoId: "vid-42",
  song: "Midnight City",
  artist: "M83",
  album: "Hurry Up, We're Dreaming",
  duration: 244,
  format: "ttml",
  language: "en",
  syncType: "richsync",
  score: 12,
  effectiveScore: 12.42,
  voteCount: 19,
  confidence: "high",
}

function renderRow(entry: LyricsSearchHit, rank = 1) {
  return render(
    <MemoryRouter>
      <ul>
        <SearchResultRow entry={entry} rank={rank} />
      </ul>
    </MemoryRouter>,
  )
}

describe("SearchResultRow", () => {
  it("renders song, artist, format badge, and effective score", () => {
    renderRow(baseHit)
    expect(screen.getByText("Midnight City")).toBeTruthy()
    expect(screen.getByText("M83")).toBeTruthy()
    expect(screen.getByText(/TTML/i)).toBeTruthy()
    expect(screen.getByText("12.4")).toBeTruthy()
  })

  it("renders the rank badge using the rank prop", () => {
    renderRow(baseHit, 3)
    expect(screen.getByText("#3")).toBeTruthy()
  })

  it("renders the album when present", () => {
    renderRow(baseHit)
    expect(screen.getByText(/Hurry Up, We're Dreaming/)).toBeTruthy()
  })

  it("omits the album line when album is missing", () => {
    const { album: _album, ...rest } = baseHit
    renderRow(rest as LyricsSearchHit)
    expect(screen.queryByText(/Hurry Up/)).toBeNull()
  })

  it("renders the duration formatted as M:SS when present", () => {
    renderRow(baseHit)
    expect(screen.getByText(/4:04/)).toBeTruthy()
  })

  it("omits the duration when zero", () => {
    const { album: _album, ...rest } = baseHit
    renderRow({ ...(rest as LyricsSearchHit), duration: 0 })
    expect(screen.queryByText(/\d+:\d{2}/)).toBeNull()
  })

  it("renders the Lyric match line when matchScore is present", () => {
    renderRow({ ...baseHit, matchScore: 0.873 })
    expect(screen.getByText(/Lyric match/i)).toBeTruthy()
    expect(screen.getByText(/0\.87/)).toBeTruthy()
  })

  it("omits the Lyric match line when matchScore is absent", () => {
    renderRow(baseHit)
    expect(screen.queryByText(/Lyric match/i)).toBeNull()
  })

  it("links to the song route with the variant id", () => {
    renderRow(baseHit)
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("/song/vid-42?variantId=42")
  })

  it("sets a descriptive aria-label on the link", () => {
    renderRow(baseHit)
    const link = screen.getByRole("link", { name: /Open lyrics for Midnight City by M83/i })
    expect(link).toBeTruthy()
  })

  it("renders the vote count next to the score", () => {
    renderRow(baseHit)
    expect(screen.getByText(/19/)).toBeTruthy()
  })
})
