import type { VariantFull } from "@/lib/types"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LyricsPanel } from "./LyricsPanel"

vi.mock("@braccato/core/element", () => ({}))

afterEach(cleanup)

const ttml = (
  translations: string,
) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="ja">
  <head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <translations>${translations}</translations>
  </iTunesMetadata></metadata></head>
  <body dur="00:00:12.000"><div>
    <p begin="00:00:01.000" end="00:00:04.000" itunes:key="L1">愛してる</p>
  </div></body>
</tt>`

const EN = '<translation type="subtitle" xml:lang="en"><text for="L1">I love you</text></translation>'
const ES = '<translation type="subtitle" xml:lang="es"><text for="L1">Te quiero</text></translation>'

function variant(lyrics: string, format: VariantFull["format"] = "ttml"): VariantFull {
  return {
    id: 1,
    videoId: "RBtlPT23PTM",
    song: "Aishiteru",
    artist: "Artist",
    format,
    syncType: "linesync",
    score: 1,
    effectiveScore: 1,
    voteCount: 1,
    confidence: "medium",
    hidden: false,
    lyrics,
  }
}

const panel = (v: VariantFull) =>
  render(<LyricsPanel variant={v} getCurrentTime={() => 0} getPlaying={() => false} onLineClick={() => {}} />)

const picker = () => screen.queryByRole("group", { name: "Translation language" })

describe("LyricsPanel translation picker", () => {
  it("offers each submitted language when the lyrics carry more than one, first picked", () => {
    panel(variant(ttml(EN + ES)))
    expect(picker()).not.toBeNull()
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "ES" }).getAttribute("aria-pressed")).toBe("false")
  })

  it("moves the pick to the clicked language", () => {
    panel(variant(ttml(EN + ES)))
    fireEvent.click(screen.getByRole("button", { name: "ES" }))
    expect(screen.getByRole("button", { name: "ES" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("false")
  })

  describe("edge cases", () => {
    it("has no picker for a single translation, which shows without asking", () => {
      panel(variant(ttml(EN)))
      expect(picker()).toBeNull()
    })

    it("has no picker for lyrics without translations", () => {
      panel(variant(ttml("")))
      expect(picker()).toBeNull()
    })

    it("has no picker for lrc", () => {
      panel(variant("[00:01.00]Fall back into place", "lrc"))
      expect(picker()).toBeNull()
    })

    it("has no picker while the variant is loading", () => {
      render(
        <LyricsPanel variant={undefined} getCurrentTime={() => 0} getPlaying={() => false} onLineClick={() => {}} />,
      )
      expect(picker()).toBeNull()
    })
  })

  describe("invariants", () => {
    it("remembers the pick across a trip to raw mode, which has no picker", () => {
      panel(variant(ttml(EN + ES)))
      fireEvent.click(screen.getByRole("button", { name: "ES" }))
      fireEvent.click(screen.getByRole("button", { name: "Raw" }))
      expect(picker()).toBeNull()
      fireEvent.click(screen.getByRole("button", { name: "Synced" }))
      expect(screen.getByRole("button", { name: "ES" }).getAttribute("aria-pressed")).toBe("true")
    })
  })
})
