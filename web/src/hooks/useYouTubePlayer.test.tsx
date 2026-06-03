import { act, render, renderHook } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetForTests, useYouTubePlayer } from "./useYouTubePlayer"

interface FakePlayerOptions {
  videoId: string
  events?: {
    onReady?: (e: { target: FakePlayer }) => void
    onStateChange?: (e: { data: number }) => void
  }
}

class FakePlayer {
  destroyed = false
  currentTime = 0
  onStateChange: ((e: { data: number }) => void) | undefined
  static instances: FakePlayer[] = []

  constructor(_elem: HTMLElement | string, opts: FakePlayerOptions) {
    this.onStateChange = opts.events?.onStateChange
    FakePlayer.instances.push(this)
    queueMicrotask(() => opts.events?.onReady?.({ target: this }))
  }
  getCurrentTime() {
    return this.currentTime
  }
  destroy() {
    this.destroyed = true
  }
}

const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }

beforeEach(() => {
  vi.useFakeTimers()
  FakePlayer.instances = []
  for (const s of Array.from(document.querySelectorAll("script[data-unison-yt-loader]"))) {
    s.remove()
  }
  ;(globalThis as unknown as { YT?: unknown; onYouTubeIframeAPIReady?: unknown }).YT = undefined
  ;(globalThis as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady = undefined
  __resetForTests()
})

afterEach(() => {
  vi.useRealTimers()
  ;(globalThis as unknown as { YT?: unknown; onYouTubeIframeAPIReady?: unknown }).YT = undefined
  ;(globalThis as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady = undefined
  __resetForTests()
})

function installYT() {
  ;(globalThis as unknown as { YT: { Player: typeof FakePlayer; PlayerState: typeof PlayerState } }).YT = {
    Player: FakePlayer,
    PlayerState,
  }
}

function Harness({ videoId }: { videoId: string | null }) {
  const { ref, currentTimeMs, playing } = useYouTubePlayer(videoId)
  return createElement(
    "div",
    null,
    createElement("div", { ref, id: "yt-mount" }),
    createElement("span", {
      "data-testid": "stats",
      "data-current-ms": String(currentTimeMs),
      "data-playing": String(playing),
    }),
  )
}

describe("useYouTubePlayer", () => {
  it("returns idle state and injects no script when videoId is null", () => {
    const { result } = renderHook(() => useYouTubePlayer(null))
    expect(result.current.currentTimeMs).toBe(0)
    expect(result.current.playing).toBe(false)
    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(0)
  })

  it("injects the iframe API script exactly once across multiple mounts when YT is not preloaded", async () => {
    const a = render(createElement(Harness, { videoId: "abc" }))
    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(1)
    a.unmount()

    const b = render(createElement(Harness, { videoId: "def" }))
    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(1)
    b.unmount()

    installYT()
    const ready = (globalThis as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady
    if (ready) {
      act(() => {
        ready()
      })
    }
    await act(async () => {
      await Promise.resolve()
    })
  })

  it("polls getCurrentTime and tracks play state via onStateChange", async () => {
    installYT()
    const { getByTestId, unmount } = render(createElement(Harness, { videoId: "abc" }))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    expect(player).toBeDefined()

    player.currentTime = 2.5
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(getByTestId("stats").getAttribute("data-current-ms")).toBe("2500")

    act(() => {
      player.onStateChange?.({ data: PlayerState.PLAYING })
    })
    expect(getByTestId("stats").getAttribute("data-playing")).toBe("true")

    act(() => {
      player.onStateChange?.({ data: PlayerState.PAUSED })
    })
    expect(getByTestId("stats").getAttribute("data-playing")).toBe("false")

    act(() => {
      player.onStateChange?.({ data: PlayerState.PLAYING })
    })
    expect(getByTestId("stats").getAttribute("data-playing")).toBe("true")

    act(() => {
      player.onStateChange?.({ data: PlayerState.ENDED })
    })
    expect(getByTestId("stats").getAttribute("data-playing")).toBe("false")

    unmount()
  })

  it("destroys the old player and constructs a new one when videoId changes", async () => {
    installYT()
    const { rerender, unmount } = render(createElement(Harness, { videoId: "abc" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(FakePlayer.instances).toHaveLength(1)
    rerender(createElement(Harness, { videoId: "def" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(FakePlayer.instances[0].destroyed).toBe(true)
    expect(FakePlayer.instances).toHaveLength(2)
    unmount()
  })

  it("destroys the player and stops polling on unmount", async () => {
    installYT()
    const { unmount } = render(createElement(Harness, { videoId: "abc" }))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    unmount()
    expect(player.destroyed).toBe(true)
    expect(() => {
      vi.advanceTimersByTime(500)
    }).not.toThrow()
  })
})
