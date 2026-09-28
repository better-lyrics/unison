import { LRCParser, TTMLParser } from "@braccato/parsers"
import { describe, expect, it } from "vitest"
import { pickTranslationLanguage, translationLanguages } from "./lyric-translations"

const ttml = (
  translations: string,
  lines = 2,
) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="ja">
  <head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <translations>${translations}</translations>
  </iTunesMetadata></metadata></head>
  <body dur="00:00:12.000"><div>
    <p begin="00:00:01.000" end="00:00:04.000" itunes:key="L1">愛してる</p>
    ${lines > 1 ? '<p begin="00:00:05.000" end="00:00:08.000" itunes:key="L2">さよなら</p>' : ""}
  </div></body>
</tt>`

const translation = (lang: string, texts: Record<string, string>) =>
  `<translation type="subtitle" xml:lang="${lang}">${Object.entries(texts)
    .map(([key, text]) => `<text for="${key}">${text}</text>`)
    .join("")}</translation>`

describe("translationLanguages", () => {
  it("lists every language a submitted ttml translates into, in document order", () => {
    const lyrics = TTMLParser.parse(
      ttml(translation("en", { L1: "I love you", L2: "Goodbye" }) + translation("es", { L1: "Te quiero" })),
    )
    expect(translationLanguages(lyrics)).toEqual(["en", "es"])
  })

  describe("edge cases", () => {
    it("is empty for a ttml without translations", () => {
      expect(translationLanguages(TTMLParser.parse(ttml("")))).toEqual([])
    })

    it("is empty for lrc, which cannot carry a translation", () => {
      expect(translationLanguages(LRCParser.parse("[00:01.00]Fall back into place"))).toEqual([])
    })

    it("is empty for no lines", () => {
      expect(translationLanguages([])).toEqual([])
    })

    it("keeps a language that covers only a later line", () => {
      const lyrics = TTMLParser.parse(
        ttml(translation("en", { L1: "I love you" }) + translation("fr", { L2: "Au revoir" })),
      )
      expect(translationLanguages(lyrics)).toEqual(["en", "fr"])
    })
  })

  describe("invariants", () => {
    it("names each language once however many lines it covers", () => {
      const lyrics = TTMLParser.parse(ttml(translation("en", { L1: "I love you", L2: "Goodbye" })))
      expect(translationLanguages(lyrics)).toEqual(["en"])
    })
  })
})

describe("pickTranslationLanguage", () => {
  it("honours a pick the lyrics carry", () => {
    expect(pickTranslationLanguage(["en", "es"], "es")).toBe("es")
  })

  describe("edge cases", () => {
    it("falls back to the first language with no pick", () => {
      expect(pickTranslationLanguage(["en", "es"])).toBe("en")
    })

    it("falls back to the first language for a pick the lyrics do not carry", () => {
      expect(pickTranslationLanguage(["en", "es"], "fr")).toBe("en")
    })

    it("picks nothing for lyrics without translations", () => {
      expect(pickTranslationLanguage([], "en")).toBeUndefined()
    })
  })
})
