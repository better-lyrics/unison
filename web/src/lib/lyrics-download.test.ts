import { describe, expect, it } from "vitest"
import { EXTENSION_BY_FORMAT, lyricsFilename, MIME_BY_FORMAT, sanitizeFilename } from "./lyrics-download"

describe("lyrics-download", () => {
  describe("EXTENSION_BY_FORMAT / MIME_BY_FORMAT", () => {
    it("maps each format to its file extension", () => {
      expect(EXTENSION_BY_FORMAT.ttml).toBe("ttml")
      expect(EXTENSION_BY_FORMAT.lrc).toBe("lrc")
      expect(EXTENSION_BY_FORMAT.plain).toBe("txt")
    })

    it("serves ttml as xml and the rest as plain text, always utf-8", () => {
      expect(MIME_BY_FORMAT.ttml).toBe("application/xml;charset=utf-8")
      expect(MIME_BY_FORMAT.lrc).toBe("text/plain;charset=utf-8")
      expect(MIME_BY_FORMAT.plain).toBe("text/plain;charset=utf-8")
    })
  })

  describe("lyricsFilename", () => {
    it("builds '<song> - <artist>.<ext>' for each format", () => {
      expect(lyricsFilename({ song: "Midnight City", artist: "M83", videoId: "v1", format: "ttml" })).toBe(
        "Midnight City - M83.ttml",
      )
      expect(lyricsFilename({ song: "Song", artist: "Artist", videoId: "v1", format: "lrc" })).toBe("Song - Artist.lrc")
      expect(lyricsFilename({ song: "Song", artist: "Artist", videoId: "v1", format: "plain" })).toBe(
        "Song - Artist.txt",
      )
    })

    describe("edge cases", () => {
      it("uses only the artist when the song is empty", () => {
        expect(lyricsFilename({ song: "   ", artist: "M83", videoId: "v1", format: "lrc" })).toBe("M83.lrc")
      })

      it("uses only the song when the artist is empty", () => {
        expect(lyricsFilename({ song: "Solo", artist: "", videoId: "v1", format: "lrc" })).toBe("Solo.lrc")
      })

      it("falls back to the videoId when song and artist are both empty", () => {
        expect(lyricsFilename({ song: "", artist: "  ", videoId: "dQw4w9WgXcQ", format: "ttml" })).toBe(
          "dQw4w9WgXcQ.ttml",
        )
      })

      it("keeps non-latin characters", () => {
        expect(lyricsFilename({ song: "夜に駆ける", artist: "YOASOBI", videoId: "v1", format: "lrc" })).toBe(
          "夜に駆ける - YOASOBI.lrc",
        )
      })

      it("strips characters that are invalid in filenames", () => {
        expect(lyricsFilename({ song: 'A/B:C*?"<>|D', artist: "E\\F", videoId: "v1", format: "plain" })).toBe(
          "ABCD - EF.txt",
        )
      })

      it("collapses internal whitespace and trims edges", () => {
        expect(
          lyricsFilename({ song: "  Too   Many   Spaces  ", artist: "The\tBand", videoId: "v1", format: "lrc" }),
        ).toBe("Too Many Spaces - The Band.lrc")
      })
    })

    describe("invariants", () => {
      it("never contains a path separator", () => {
        const name = lyricsFilename({ song: "a/b\\c", artist: "d/e\\f", videoId: "g/h", format: "lrc" })
        expect(name.includes("/")).toBe(false)
        expect(name.includes("\\")).toBe(false)
      })

      it("always ends with the extension for the given format", () => {
        for (const format of ["ttml", "lrc", "plain"] as const) {
          const name = lyricsFilename({ song: "S", artist: "A", videoId: "v", format })
          expect(name.endsWith(`.${EXTENSION_BY_FORMAT[format]}`)).toBe(true)
        }
      })
    })
  })

  describe("sanitizeFilename", () => {
    it("removes control characters", () => {
      expect(sanitizeFilename("abcd")).toBe("abcd")
    })

    it("trims leading and trailing dots and whitespace", () => {
      expect(sanitizeFilename("  ..name..  ")).toBe("name")
    })

    it("returns an empty string when nothing survives", () => {
      expect(sanitizeFilename("///")).toBe("")
    })
  })
})
