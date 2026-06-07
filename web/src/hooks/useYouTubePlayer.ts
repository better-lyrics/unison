import { useCallback, useEffect, useRef, useState } from "react"

interface YTPlayer {
  getCurrentTime(): number
  getPlayerState(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  destroy(): void
}

const YT_STATE_PLAYING = 1

interface YTPlayerCtorOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: { origin?: string }
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerCtorOptions) => YTPlayer
}

type WindowWithYT = Window & {
  YT?: YTNamespace
  onYouTubeIframeAPIReady?: () => void
}

const SCRIPT_URL = "https://www.youtube.com/iframe_api"
const SCRIPT_ATTR = "data-unison-yt-loader"
interface ReadyWaiter {
  resolve: (yt: YTNamespace) => void
  reject: (err: Error) => void
}
const readyWaiters: ReadyWaiter[] = []
let scriptInjected = false

function getWindow(): WindowWithYT | null {
  if (typeof window === "undefined") return null
  return window as WindowWithYT
}

function ensureScript(win: WindowWithYT): Promise<YTNamespace> {
  return new Promise((resolve, reject) => {
    if (win.YT?.Player) {
      resolve(win.YT)
      return
    }
    if (!scriptInjected) {
      scriptInjected = true
      const existing = document.querySelector(`script[${SCRIPT_ATTR}]`)
      if (!existing) {
        const tag = document.createElement("script")
        tag.src = SCRIPT_URL
        tag.async = true
        tag.setAttribute(SCRIPT_ATTR, "1")
        tag.onerror = () => {
          tag.remove()
          scriptInjected = false
          const err = new Error("yt-iframe-api-failed")
          for (const w of readyWaiters.splice(0)) w.reject(err)
        }
        document.head.appendChild(tag)
      }
      const prior = win.onYouTubeIframeAPIReady
      win.onYouTubeIframeAPIReady = () => {
        prior?.()
        const yt = win.YT
        if (!yt) return
        for (const w of readyWaiters.splice(0)) w.resolve(yt)
      }
    }
    readyWaiters.push({ resolve, reject })
  })
}

export function __resetForTests(): void {
  scriptInjected = false
  readyWaiters.length = 0
}

export interface UseYouTubePlayerResult {
  ref: (node: HTMLDivElement | null) => void
  getCurrentTimeMs: () => number
  getPlaying: () => boolean
  seekTo: (seconds: number) => void
}

export function useYouTubePlayer(videoId: string | null): UseYouTubePlayerResult {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)

  useEffect(() => {
    if (!videoId || !node) return
    const win = getWindow()
    if (!win) return

    let cancelled = false

    const run = async () => {
      const yt = await ensureScript(win).catch(() => null)
      if (cancelled || !yt) return
      const player = new yt.Player(node, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { origin: win.location.origin },
      })
      playerRef.current = player
    }
    run()

    return () => {
      cancelled = true
      const player = playerRef.current
      if (player) player.destroy()
      playerRef.current = null
    }
  }, [videoId, node])

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current
    if (!player) return
    player.seekTo(seconds, true)
  }, [])

  const getCurrentTimeMs = useCallback(() => {
    const player = playerRef.current
    if (!player) return 0
    return player.getCurrentTime() * 1000
  }, [])

  const getPlaying = useCallback(() => {
    const player = playerRef.current
    if (!player) return false
    return player.getPlayerState() === YT_STATE_PLAYING
  }, [])

  return { ref: setNode, getCurrentTimeMs, getPlaying, seekTo }
}
