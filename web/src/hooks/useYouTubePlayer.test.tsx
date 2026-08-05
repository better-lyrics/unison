import { act, render, renderHook } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type UseYouTubePlayerResult, __resetForTests, useYouTubePlayer } from "./useYouTubePlayer"

interface FakePlayerOptions {
  videoId: string
  events?: { onReady?: () => void }
}

// Models the real YT.Player: methods are NOT attached until the iframe posts
// "initialDelivery" and onReady fires. Calling one before then throws, exactly
// like `player.getCurrentTime is not a function` in production.
class FakePlayer {
  destroyed = false
  ready = false
  currentTime = 0
  state = 2
  seeks: Array<{ seconds: number; allowSeekAhead: boolean }> = []
  plays = 0
  onReady?: () => void
  static instances: FakePlayer[] = []

  constructor(_elem: HTMLElement | string, opts: FakePlayerOptions) {
    this.onReady = opts.events?.onReady
    FakePlayer.instances.push(this)
  }
  fireReady() {
    this.ready = true
    this.onReady?.()
  }
  getCurrentTime() {
    if (!this.ready) throw new TypeError("getCurrentTime is not a function")
    return this.currentTime
  }
  getPlayerState() {
    if (!this.ready) throw new TypeError("getPlayerState is not a function")
    return this.state
  }
  seekTo(seconds: number, allowSeekAhead: boolean) {
    if (!this.ready) throw new TypeError("seekTo is not a function")
    this.seeks.push({ seconds, allowSeekAhead })
    this.currentTime = seconds
  }
  playVideo() {
    if (!this.ready) throw new TypeError("playVideo is not a function")
    this.plays++
    this.state = PlayerState.PLAYING
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
    expect(result.current.getCurrentTime()).toBe(0)
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
      player.fireReady()
    })
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

  it("getters read currentTime in seconds and playing-state directly from the player", async () => {
    installYT()
    let getCurrentTime: (() => number) | null = null
    let getPlaying: (() => boolean) | null = null
    function CaptureHarness() {
      const player = useYouTubePlayer("abc")
      getCurrentTime = player.getCurrentTime
      getPlaying = player.getPlaying
      return createElement("div", { ref: player.ref })
    }
    const { unmount } = render(createElement(CaptureHarness))
    await act(async () => {
      await Promise.resolve()
    })
    const player = FakePlayer.instances[0]
    expect(player).toBeDefined()
    if (getCurrentTime === null || getPlaying === null) throw new Error("getters never captured")
    const readTime: () => number = getCurrentTime
    const readPlaying: () => boolean = getPlaying

    act(() => {
      player.fireReady()
    })

    player.currentTime = 2.5
    expect(readTime()).toBe(2.5)

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

  it("removes the script and allows re-injection when the script load fails", async () => {
    const first = render(createElement(Harness, { videoId: "abc" }))
    const injected = document.querySelectorAll("script[data-unison-yt-loader]")
    expect(injected.length).toBe(1)
    const tag = injected[0] as HTMLScriptElement

    act(() => {
      tag.dispatchEvent(new Event("error"))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(0)
    first.unmount()

    const second = render(createElement(Harness, { videoId: "def" }))
    expect(document.querySelectorAll("script[data-unison-yt-loader]").length).toBe(1)
    second.unmount()
  })

  it("does not throw when the script load fails", async () => {
    const { unmount } = render(createElement(Harness, { videoId: "abc" }))
    const tag = document.querySelector("script[data-unison-yt-loader]") as HTMLScriptElement
    act(() => {
      tag.dispatchEvent(new Event("error"))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(() => unmount()).not.toThrow()
  })
})

describe("useYouTubePlayer readiness gating", () => {
  let result: UseYouTubePlayerResult
  let unmount: () => void

  async function mountFor(videoId: string) {
    installYT()
    function CaptureHarness() {
      result = useYouTubePlayer(videoId)
      return createElement("div", { ref: result.ref })
    }
    const rendered = render(createElement(CaptureHarness))
    unmount = rendered.unmount
    await act(async () => {
      await Promise.resolve()
    })
    return rendered
  }

  // The real YT.Player attaches getCurrentTime/getPlayerState/seekTo only after
  // onReady fires; calling one before then throws. The rAF sync loop in
  // LyricsRenderer calls these every frame, so an unguarded pre-ready call threw
  // and killed the loop forever ("barely works most of the time"). These lock in
  // that the hook never touches the player before onReady.
  it("regression: getCurrentTime returns 0 and does not throw before the player is ready", async () => {
    await mountFor("abc")
    expect(FakePlayer.instances[0].ready).toBe(false)
    expect(() => result.getCurrentTime()).not.toThrow()
    expect(result.getCurrentTime()).toBe(0)
    unmount()
  })

  it("regression: getPlaying returns false and does not throw before the player is ready", async () => {
    await mountFor("abc")
    expect(() => result.getPlaying()).not.toThrow()
    expect(result.getPlaying()).toBe(false)
    unmount()
  })

  it("regression: seekTo is a no-op and does not throw before the player is ready", async () => {
    await mountFor("abc")
    expect(() => result.seekTo(9)).not.toThrow()
    expect(FakePlayer.instances[0].seeks).toEqual([])
    unmount()
  })

  it("regression: play is a no-op and does not throw before the player is ready", async () => {
    await mountFor("abc")
    expect(() => result.play()).not.toThrow()
    expect(FakePlayer.instances[0].plays).toBe(0)
    unmount()
  })

  it("play starts the underlying player once it is ready", async () => {
    await mountFor("abc")
    const player = FakePlayer.instances[0]
    act(() => {
      player.fireReady()
    })
    expect(result.getPlaying()).toBe(false)
    act(() => {
      result.play()
    })
    expect(player.plays).toBe(1)
    expect(result.getPlaying()).toBe(true)
    unmount()
  })

  it("starts reading real player values only once onReady fires", async () => {
    await mountFor("abc")
    const player = FakePlayer.instances[0]
    player.currentTime = 3
    player.state = 1
    expect(result.getCurrentTime()).toBe(0)
    expect(result.getPlaying()).toBe(false)

    act(() => {
      player.fireReady()
    })
    expect(result.getCurrentTime()).toBe(3)
    expect(result.getPlaying()).toBe(true)
    unmount()
  })

  it("regression: changing videoId resets readiness so the new player is not queried before its onReady", async () => {
    function Harness2({ videoId }: { videoId: string }) {
      result = useYouTubePlayer(videoId)
      return createElement("div", { ref: result.ref })
    }
    installYT()
    const rendered = render(createElement(Harness2, { videoId: "abc" }))
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      FakePlayer.instances[0].fireReady()
    })
    expect(result.getCurrentTime).toBeDefined()

    rendered.rerender(createElement(Harness2, { videoId: "def" }))
    await act(async () => {
      await Promise.resolve()
    })
    const next = FakePlayer.instances[1]
    expect(next.ready).toBe(false)
    expect(() => result.getCurrentTime()).not.toThrow()
    expect(result.getCurrentTime()).toBe(0)

    next.currentTime = 5
    act(() => {
      next.fireReady()
    })
    expect(result.getCurrentTime()).toBe(5)
    rendered.unmount()
  })
})
