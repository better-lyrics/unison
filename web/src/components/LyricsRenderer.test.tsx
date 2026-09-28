import type { VariantFull } from "@/lib/types"
import type { Lyric } from "@braccato/parsers"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Registering the custom element needs a layout engine happy-dom does not have. The component's
// contract with it is the properties and events below, and those are what these exercise.
vi.mock("@braccato/core/element", () => ({}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body dur="00:00:12.000">
    <div begin="00:00:01.000" end="00:00:08.000">
      <p begin="00:00:01.000" end="00:00:04.000"><span begin="00:00:01.000" end="00:00:02.000">Hold </span><span begin="00:00:02.000" end="00:00:04.000">on</span></p>
      <p begin="00:00:05.000" end="00:00:08.000">to what we made</p>
    </div>
  </body>
</tt>`

const LRC = "[ar:Beach House]\n[ti:Space Song]\n[00:01.00]Fall back into place\n[00:05.50]Black out the sun"

const PLAIN = "Fall back into place\nBlack out the sun"

const TRANSLATED_TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="ja">
  <head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <translations>
      <translation type="subtitle" xml:lang="en"><text for="L1">I love you</text><text for="L2">Goodbye</text></translation>
      <translation type="subtitle" xml:lang="es"><text for="L1">Te quiero</text></translation>
    </translations>
    <transliterations>
      <transliteration xml:lang="ja-Latn"><text for="L1">aishiteru</text></transliteration>
    </transliterations>
  </iTunesMetadata></metadata></head>
  <body dur="00:00:12.000"><div>
    <p begin="00:00:01.000" end="00:00:04.000" itunes:key="L1">愛してる</p>
    <p begin="00:00:05.000" end="00:00:08.000" itunes:key="L2">さよなら</p>
  </div></body>
</tt>`

type LyricsElement = HTMLElement & {
  lyrics?: Lyric[] | null
  theme?: string
  currentTime?: number
  playing?: boolean
  renderer?: { noteUserScroll: () => void } | FakeRenderer | null
}

interface FakeRenderer {
  noteUserScroll: () => void
  lines: { lyricElement: HTMLElement }[]
  scheduleLyricPositionUpdate: ReturnType<typeof vi.fn>
}

function buildLines(el: LyricsElement, count: number): FakeRenderer {
  const renderer: FakeRenderer = {
    noteUserScroll: () => {},
    lines: Array.from({ length: count }, () => ({ lyricElement: document.createElement("div") })),
    scheduleLyricPositionUpdate: vi.fn(),
  }
  el.renderer = renderer
  el.dispatchEvent(new CustomEvent("braccato:lyrics-loaded"))
  return renderer
}

const decoration = (line: { lyricElement: HTMLElement }, kind: "translated" | "romanized") =>
  line.lyricElement.querySelector(`.blyrics--${kind}`)?.textContent ?? null

function makeVariant(overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    id: 1,
    videoId: "RBtlPT23PTM",
    song: "Space Song",
    artist: "Beach House",
    format: "ttml",
    syncType: "richsync",
    score: 4,
    effectiveScore: 4.2,
    voteCount: 6,
    confidence: "high",
    hidden: false,
    lyrics: TTML,
    ...overrides,
  }
}

async function importRenderer() {
  const mod = await import("./LyricsRenderer")
  return mod.LyricsRenderer
}

const zero = () => 0
const stopped = () => false

async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
}

function elementIn(container: HTMLElement): LyricsElement {
  const el = container.querySelector("braccato-lyrics")
  if (!el) throw new Error("<braccato-lyrics> never rendered")
  return el as LyricsElement
}

describe("LyricsRenderer", () => {
  it("hands the element the lines parsed out of a ttml variant, syllables included", async () => {
    const Renderer = await importRenderer()
    const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
    const lyrics = elementIn(container).lyrics
    expect(lyrics).toHaveLength(2)
    expect(lyrics?.[0]).toMatchObject({ startTimeMs: 1000, durationMs: 3000, words: "Hold on" })
    expect(lyrics?.[0].parts?.map((p) => p.words)).toEqual(["Hold ", "on"])
    expect(lyrics?.[1]).toMatchObject({ startTimeMs: 5000, words: "to what we made" })
  })

  it("lets the caller size the element and override the default height", async () => {
    const Renderer = await importRenderer()
    const { container } = render(
      <Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} className="h-[360px] max-w-none" />,
    )
    const classes = elementIn(container).className.split(" ")
    expect(classes).toContain("h-[360px]")
    expect(classes).toContain("max-w-none")
    expect(classes).not.toContain("h-[576px]")
    expect(classes).not.toContain("max-w-3xl")
  })

  it("parses an lrc variant with the lrc parser rather than guessing at the body", async () => {
    const Renderer = await importRenderer()
    const { container } = render(
      <Renderer variant={makeVariant({ format: "lrc", lyrics: LRC })} getCurrentTime={zero} getPlaying={stopped} />,
    )
    const lyrics = elementIn(container).lyrics
    expect(lyrics).toHaveLength(2)
    expect(lyrics?.[0]).toMatchObject({ startTimeMs: 1000, words: "Fall back into place" })
    expect(lyrics?.[1]).toMatchObject({ startTimeMs: 5500, words: "Black out the sun" })
  })

  it("parses a plain variant into untimed lines", async () => {
    const Renderer = await importRenderer()
    const { container } = render(
      <Renderer variant={makeVariant({ format: "plain", lyrics: PLAIN })} getCurrentTime={zero} getPlaying={stopped} />,
    )
    expect(elementIn(container).lyrics).toEqual([
      { startTimeMs: 0, words: "Fall back into place", durationMs: 0 },
      { startTimeMs: 0, words: "Black out the sun", durationMs: 0 },
    ])
  })

  it("drives currentTime in seconds and playing on the element from the getters every frame", async () => {
    const Renderer = await importRenderer()
    let now = 12.5
    let isPlaying = true
    const { container } = render(
      <Renderer variant={makeVariant()} getCurrentTime={() => now} getPlaying={() => isPlaying} />,
    )
    const el = elementIn(container)
    await nextFrame()
    expect(el.currentTime).toBe(12.5)
    expect(el.playing).toBe(true)

    now = 61
    isPlaying = false
    await nextFrame()
    expect(el.currentTime).toBe(61)
    expect(el.playing).toBe(false)
  })

  it("invokes onLineClick with the seconds the element asked to seek to", async () => {
    const Renderer = await importRenderer()
    const onLineClick = vi.fn()
    const { container } = render(
      <Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} onLineClick={onLineClick} />,
    )
    elementIn(container).dispatchEvent(new CustomEvent("braccato:line-click", { detail: { timeS: 4.5 } }))
    expect(onLineClick).toHaveBeenCalledWith(4.5)
  })

  it("hands the element the theme, whose comments carry the engine settings", async () => {
    const Renderer = await importRenderer()
    const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
    const theme = elementIn(container).theme ?? ""
    expect(theme).toContain("blyrics-target-scroll-pos-ratio")
    expect(theme).toContain(".blyrics-container")
  })

  it("tells the renderer about a user scroll so autoscroll steps aside", async () => {
    const Renderer = await importRenderer()
    const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
    const el = elementIn(container)
    const noteUserScroll = vi.fn()
    el.renderer = { noteUserScroll }
    el.dispatchEvent(new Event("scroll"))
    expect(noteUserScroll).toHaveBeenCalledTimes(1)
  })

  describe("submitted translations", () => {
    it("hangs the first submitted translation and the romanisation under each line they cover", async () => {
      const Renderer = await importRenderer()
      const { container } = render(
        <Renderer variant={makeVariant({ lyrics: TRANSLATED_TTML })} getCurrentTime={zero} getPlaying={stopped} />,
      )
      const renderer = buildLines(elementIn(container), 2)
      expect(renderer.lines.map((line) => decoration(line, "translated"))).toEqual(["I love you", "Goodbye"])
      expect(renderer.lines.map((line) => decoration(line, "romanized"))).toEqual(["aishiteru", null])
      expect(renderer.scheduleLyricPositionUpdate).toHaveBeenCalledTimes(1)
    })

    it("shows the picked language instead of the first", async () => {
      const Renderer = await importRenderer()
      const { container } = render(
        <Renderer
          variant={makeVariant({ lyrics: TRANSLATED_TTML })}
          translationLang="es"
          getCurrentTime={zero}
          getPlaying={stopped}
        />,
      )
      const renderer = buildLines(elementIn(container), 2)
      expect(renderer.lines.map((line) => decoration(line, "translated"))).toEqual(["Te quiero", null])
      expect(renderer.lines.map((line) => decoration(line, "romanized"))).toEqual(["aishiteru", null])
    })

    it("decorates the lines of every rebuild with the language picked last", async () => {
      const Renderer = await importRenderer()
      const variant = makeVariant({ lyrics: TRANSLATED_TTML })
      const { container, rerender } = render(<Renderer variant={variant} getCurrentTime={zero} getPlaying={stopped} />)
      const el = elementIn(container)
      buildLines(el, 2)
      rerender(<Renderer variant={variant} translationLang="es" getCurrentTime={zero} getPlaying={stopped} />)
      const rebuilt = buildLines(el, 2)
      expect(decoration(rebuilt.lines[0], "translated")).toBe("Te quiero")
    })

    describe("edge cases", () => {
      it("adds nothing to lyrics submitted without translations", async () => {
        const Renderer = await importRenderer()
        const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
        const renderer = buildLines(elementIn(container), 2)
        expect(renderer.lines.map((line) => line.lyricElement.childElementCount)).toEqual([0, 0])
      })

      it("falls back to the first language when the picked one is not in the file", async () => {
        const Renderer = await importRenderer()
        const { container } = render(
          <Renderer
            variant={makeVariant({ lyrics: TRANSLATED_TTML })}
            translationLang="fr"
            getCurrentTime={zero}
            getPlaying={stopped}
          />,
        )
        const renderer = buildLines(elementIn(container), 2)
        expect(decoration(renderer.lines[0], "translated")).toBe("I love you")
      })

      it("survives a load event while the element is between renderers", async () => {
        const Renderer = await importRenderer()
        const { container } = render(
          <Renderer variant={makeVariant({ lyrics: TRANSLATED_TTML })} getCurrentTime={zero} getPlaying={stopped} />,
        )
        const el = elementIn(container)
        el.renderer = null
        expect(() => el.dispatchEvent(new CustomEvent("braccato:lyrics-loaded"))).not.toThrow()
      })
    })
  })

  describe("edge cases", () => {
    it("forwards a line click at the very start of the song", async () => {
      const Renderer = await importRenderer()
      const onLineClick = vi.fn()
      const { container } = render(
        <Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} onLineClick={onLineClick} />,
      )
      elementIn(container).dispatchEvent(new CustomEvent("braccato:line-click", { detail: { timeS: 0 } }))
      expect(onLineClick).toHaveBeenCalledWith(0)
    })

    it("renders an empty line list for an empty ttml body rather than throwing", async () => {
      const Renderer = await importRenderer()
      const { container } = render(
        <Renderer
          variant={makeVariant({ lyrics: "<tt><body></body></tt>" })}
          getCurrentTime={zero}
          getPlaying={stopped}
        />,
      )
      expect(elementIn(container).lyrics).toEqual([])
    })

    it("stays quiet when no onLineClick was given", async () => {
      const Renderer = await importRenderer()
      const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
      expect(() =>
        elementIn(container).dispatchEvent(new CustomEvent("braccato:line-click", { detail: { timeS: 3 } })),
      ).not.toThrow()
    })
  })

  describe("error paths", () => {
    it("ignores a line click whose detail carries no time", async () => {
      const Renderer = await importRenderer()
      const onLineClick = vi.fn()
      const { container } = render(
        <Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} onLineClick={onLineClick} />,
      )
      const el = elementIn(container)
      expect(() => el.dispatchEvent(new CustomEvent("braccato:line-click", { detail: {} }))).not.toThrow()
      expect(() => el.dispatchEvent(new CustomEvent("braccato:line-click"))).not.toThrow()
      expect(onLineClick).not.toHaveBeenCalled()
    })

    it("survives a scroll while the element is between renderers", async () => {
      const Renderer = await importRenderer()
      const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
      const el = elementIn(container)
      el.renderer = null
      expect(() => el.dispatchEvent(new Event("scroll"))).not.toThrow()
    })
  })

  describe("invariants", () => {
    it("registers each listener once across re-renders and dispatches to the latest handler", async () => {
      const Renderer = await importRenderer()
      const variant = makeVariant()
      const addEventListener = vi.spyOn(HTMLElement.prototype, "addEventListener")
      const calls: string[] = []
      const { container, rerender } = render(
        <Renderer
          variant={variant}
          getCurrentTime={zero}
          getPlaying={stopped}
          onLineClick={(s) => calls.push(`first:${s}`)}
        />,
      )
      rerender(
        <Renderer
          variant={variant}
          getCurrentTime={zero}
          getPlaying={stopped}
          onLineClick={(s) => calls.push(`second:${s}`)}
        />,
      )
      // React registers a scroll listener of its own on the root container, so count only the ones
      // that landed on the element itself.
      const el = elementIn(container)
      const registered = addEventListener.mock.calls
        .filter((_, i) => addEventListener.mock.contexts[i] === el)
        .map((args) => args[0])
      expect(registered.filter((name) => name === "braccato:line-click")).toHaveLength(1)
      expect(registered.filter((name) => name === "scroll")).toHaveLength(1)

      el.dispatchEvent(new CustomEvent("braccato:line-click", { detail: { timeS: 1 } }))
      expect(calls).toEqual(["second:1"])
    })

    it("re-parses only when the variant body or format changes", async () => {
      const Renderer = await importRenderer()
      const { container, rerender } = render(
        <Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />,
      )
      const el = elementIn(container)
      const first = el.lyrics

      rerender(<Renderer variant={makeVariant({ score: 99 })} getCurrentTime={zero} getPlaying={stopped} />)
      expect(el.lyrics).toBe(first)

      rerender(
        <Renderer
          variant={makeVariant({ id: 2, format: "lrc", lyrics: LRC })}
          getCurrentTime={zero}
          getPlaying={stopped}
        />,
      )
      expect(el.lyrics).not.toBe(first)
      expect(el.lyrics?.[0]).toMatchObject({ words: "Fall back into place" })
    })

    it("stops driving the clock once unmounted", async () => {
      const Renderer = await importRenderer()
      const getCurrentTime = vi.fn(() => 0)
      const { unmount } = render(
        <Renderer variant={makeVariant()} getCurrentTime={getCurrentTime} getPlaying={stopped} />,
      )
      await nextFrame()
      expect(getCurrentTime).toHaveBeenCalled()
      unmount()
      getCurrentTime.mockClear()
      await nextFrame()
      await nextFrame()
      expect(getCurrentTime).not.toHaveBeenCalled()
    })
  })

  describe("parseVariantLyrics", () => {
    it("hands back the same lines for the same body, so the panel and the renderer parse once", async () => {
      const { parseVariantLyrics } = await import("./LyricsRenderer")
      const variant = makeVariant({ lyrics: TRANSLATED_TTML })
      expect(parseVariantLyrics({ ...variant })).toBe(parseVariantLyrics({ ...variant }))
    })

    it("parses again when the body or the format changes", async () => {
      const { parseVariantLyrics } = await import("./LyricsRenderer")
      const ttml = parseVariantLyrics(makeVariant())
      const other = parseVariantLyrics(makeVariant({ lyrics: TRANSLATED_TTML }))
      expect(other).not.toBe(ttml)
      expect(other[0]).toMatchObject({ words: "愛してる" })
      const plain = parseVariantLyrics(makeVariant({ format: "plain", lyrics: PLAIN }))
      const lrc = parseVariantLyrics(makeVariant({ format: "lrc", lyrics: PLAIN }))
      expect(lrc).not.toBe(plain)
    })
  })

  describe("regressions", () => {
    it("regression: never asks the element to fetch the body over the network", async () => {
      const Renderer = await importRenderer()
      const { container } = render(<Renderer variant={makeVariant()} getCurrentTime={zero} getPlaying={stopped} />)
      expect(elementIn(container).hasAttribute("src")).toBe(false)
    })
  })
})
