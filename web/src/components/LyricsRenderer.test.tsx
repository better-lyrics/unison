import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { VariantFull } from "@/lib/types"

vi.mock("@braccato/core", () => ({}))

const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockReset()
  revokeObjectURL.mockReset()
  let counter = 0
  createObjectURL.mockImplementation(() => `blob:fake-${++counter}`)
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeVariant(overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    id: 1,
    videoId: "vid",
    song: "Song",
    artist: "Artist",
    format: "ttml",
    syncType: "richsync",
    score: 1,
    effectiveScore: 1,
    voteCount: 1,
    confidence: "low",
    hidden: false,
    lyrics: "<tt><body><div><p>hello</p></div></body></tt>",
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

describe("LyricsRenderer", () => {
  it("creates a blob URL from the variant lyrics and assigns it to src", async () => {
    const Renderer = await importRenderer()
    const variant = makeVariant()
    const { container } = render(
      <Renderer variant={variant} getCurrentTimeMs={zero} getPlaying={stopped} />,
    )
    const el = container.querySelector("braccato-lyrics") as HTMLElement
    expect(el).toBeTruthy()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(el.getAttribute("src")).toMatch(/^blob:fake-1$/)
  })

  it("uses application/ttml+xml for the ttml format", async () => {
    const Renderer = await importRenderer()
    render(
      <Renderer variant={makeVariant({ format: "ttml" })} getCurrentTimeMs={zero} getPlaying={stopped} />,
    )
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe("application/ttml+xml")
  })

  it("uses text/lrc for the lrc format", async () => {
    const Renderer = await importRenderer()
    render(
      <Renderer
        variant={makeVariant({ format: "lrc", lyrics: "[00:10.00]hi" })}
        getCurrentTimeMs={zero}
        getPlaying={stopped}
      />,
    )
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe("text/lrc")
  })

  it("uses text/plain for the plain format", async () => {
    const Renderer = await importRenderer()
    render(
      <Renderer
        variant={makeVariant({ format: "plain", lyrics: "hi" })}
        getCurrentTimeMs={zero}
        getPlaying={stopped}
      />,
    )
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe("text/plain")
  })

  it("drives currentTime and playing on the element from the getters every frame", async () => {
    const Renderer = await importRenderer()
    let nowMs = 1234
    let isPlaying = true
    const { container } = render(
      <Renderer
        variant={makeVariant()}
        getCurrentTimeMs={() => nowMs}
        getPlaying={() => isPlaying}
      />,
    )
    const el = container.querySelector("braccato-lyrics") as HTMLElement & {
      currentTime?: number
      playing?: boolean
    }
    await nextFrame()
    expect(el.currentTime).toBe(1234)
    expect(el.playing).toBe(true)

    nowMs = 5000
    isPlaying = false
    await nextFrame()
    expect(el.currentTime).toBe(5000)
    expect(el.playing).toBe(false)
  })

  it("revokes the blob URL on unmount", async () => {
    const Renderer = await importRenderer()
    const { unmount } = render(
      <Renderer variant={makeVariant()} getCurrentTimeMs={zero} getPlaying={stopped} />,
    )
    unmount()
    expect(revokeObjectURL).toHaveBeenCalled()
    const arg = revokeObjectURL.mock.calls[0][0]
    expect(arg).toMatch(/^blob:fake-/)
  })

  it("invokes onLineClick with the time in seconds when the element fires braccato:line-click", async () => {
    const Renderer = await importRenderer()
    const onLineClick = vi.fn()
    const { container } = render(
      <Renderer
        variant={makeVariant()}
        getCurrentTimeMs={zero}
        getPlaying={stopped}
        onLineClick={onLineClick}
      />,
    )
    const el = container.querySelector("braccato-lyrics") as HTMLElement
    el.dispatchEvent(new CustomEvent("braccato:line-click", { detail: { time: 4500, lineIndex: 2 } }))
    expect(onLineClick).toHaveBeenCalledWith(4.5)
  })

  it("does not throw when braccato:line-click fires without a detail.time", async () => {
    const Renderer = await importRenderer()
    const onLineClick = vi.fn()
    const { container } = render(
      <Renderer
        variant={makeVariant()}
        getCurrentTimeMs={zero}
        getPlaying={stopped}
        onLineClick={onLineClick}
      />,
    )
    const el = container.querySelector("braccato-lyrics") as HTMLElement
    expect(() => el.dispatchEvent(new CustomEvent("braccato:line-click", { detail: {} }))).not.toThrow()
    expect(onLineClick).not.toHaveBeenCalled()
  })

  it("registers the braccato:line-click listener once across re-renders and dispatches to the latest handler", async () => {
    const Renderer = await importRenderer()
    const variant = makeVariant()
    const addEventListener = vi.spyOn(HTMLElement.prototype, "addEventListener")
    try {
      const calls: string[] = []
      const { container, rerender } = render(
        <Renderer
          variant={variant}
          getCurrentTimeMs={zero}
          getPlaying={stopped}
          onLineClick={(s) => calls.push(`first:${s}`)}
        />,
      )
      rerender(
        <Renderer
          variant={variant}
          getCurrentTimeMs={zero}
          getPlaying={stopped}
          onLineClick={(s) => calls.push(`second:${s}`)}
        />,
      )
      rerender(
        <Renderer
          variant={variant}
          getCurrentTimeMs={zero}
          getPlaying={stopped}
          onLineClick={(s) => calls.push(`third:${s}`)}
        />,
      )
      const lineClickRegistrations = addEventListener.mock.calls.filter((args) => args[0] === "braccato:line-click")
      expect(lineClickRegistrations).toHaveLength(1)
      const el = container.querySelector("braccato-lyrics") as HTMLElement
      el.dispatchEvent(new CustomEvent("braccato:line-click", { detail: { time: 1000 } }))
      expect(calls).toEqual(["third:1"])
    } finally {
      addEventListener.mockRestore()
    }
  })

  it("creates a new blob URL when the variant changes", async () => {
    const Renderer = await importRenderer()
    const { rerender } = render(
      <Renderer variant={makeVariant()} getCurrentTimeMs={zero} getPlaying={stopped} />,
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    rerender(
      <Renderer
        variant={makeVariant({ id: 2, lyrics: "different" })}
        getCurrentTimeMs={zero}
        getPlaying={stopped}
      />,
    )
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
