import { act, render, renderHook } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetForTests, useYouTubePlayer } from "./useYouTubePlayer"

interface FakePlayerOptions {
  videoId: string
}

class FakePlayer {
  destroyed = false
  currentTime = 0
  state = 2
  seeks: Array<{ seconds: number; allowSeekAhead: boolean }> = []
  static instances: FakePlayer[] = []

  constructor(_elem: HTMLElement | string, _opts: FakePlayerOptions) {
    FakePlayer.instances.push(this)
  }
  getCurrentTime() {
    return this.currentTime
  }
  getPlayerState() {
    return this.state
  }
  seekTo(seconds: number, allowSeekAhead: boolean) {
    this.seeks.push({ seconds, allowSeekAhead })
    this.currentTime = seconds
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
  ;(globalThis as unknown as { YT: { Player: typeof FakePlayer } }).YT = { Player: FakePlayer }
}

function Harness({ videoId }: { videoId: string | null }) {
  const { ref } = useYouTubePlayer(videoId)
  return createElement("div", null, createElement("div", { ref, id: "yt-mount" }))
}

describe("useYouTubePlayer", () => {
  it("returns ref-and-getter shape and injects no script when videoId is null", () => {
    const { result } = renderHook(() => useYouTubePlayer(null))
    expect(typeof result.current.ref).toBe("function")
    expect(typeof result.current.seekTo).toBe("function")
    expect(result.current.getCurrentTimeMs()).toBe(0)
    expect(result.current.getPlaying()).toBe(false)
    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(0)
  })

  it("seekTo is a no-op when the player is not ready", () => {
    const { result } = renderHook(() => useYouTubePlayer(null))
    expect(() => result.current.seekTo(12.5)).not.toThrow()
  })

  it("seekTo forwards to the underlying player once it is ready", async () => {
    installYT()
    let captured: { seekTo: (s: number) => void } | null = null
    function CaptureHarness() {
      const player = useYouTubePlayer("abc")
      captured = { seekTo: player.seekTo }
      return createElement("div", { ref: player.ref })
    }
    const { unmount } = render(createElement(CaptureHarness))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    expect(player).toBeDefined()
    act(() => {
      captured?.seekTo(7.25)
    })
    expect(player.seeks).toEqual([{ seconds: 7.25, allowSeekAhead: true }])
    unmount()
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

  it("getters read currentTime in ms and playing-state directly from the player", async () => {
    installYT()
    let getCurrentTimeMs: (() => number) | null = null
    let getPlaying: (() => boolean) | null = null
    function CaptureHarness() {
      const player = useYouTubePlayer("abc")
      getCurrentTimeMs = player.getCurrentTimeMs
      getPlaying = player.getPlaying
      return createElement("div", { ref: player.ref })
    }
    const { unmount } = render(createElement(CaptureHarness))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    expect(player).toBeDefined()
    if (getCurrentTimeMs === null || getPlaying === null) throw new Error("getters never captured")
    const readTime: () => number = getCurrentTimeMs
    const readPlaying: () => boolean = getPlaying

    player.currentTime = 2.5
    expect(readTime()).toBe(2500)

    player.state = PlayerState.PLAYING
    expect(readPlaying()).toBe(true)

    player.state = PlayerState.PAUSED
    expect(readPlaying()).toBe(false)

    player.state = PlayerState.ENDED
    expect(readPlaying()).toBe(false)

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

  it("destroys the player on unmount", async () => {
    installYT()
    const { unmount } = render(createElement(Harness, { videoId: "abc" }))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    unmount()
    expect(player.destroyed).toBe(true)
  })
})
