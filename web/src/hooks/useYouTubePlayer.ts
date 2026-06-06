import { useCallback, useEffect, useRef, useState } from "react"

interface YTPlayer {
  getCurrentTime(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  destroy(): void
}

interface YTPlayerCtorOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: { origin?: string }
  events?: {
    onReady?: (e: { target: YTPlayer }) => void
    onStateChange?: (e: { data: number }) => void
  }
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerCtorOptions) => YTPlayer
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
}

type WindowWithYT = Window & {
  YT?: YTNamespace
  onYouTubeIframeAPIReady?: () => void
}

const SCRIPT_URL = "https://www.youtube.com/iframe_api"
const SCRIPT_ATTR = "data-unison-yt-loader"
const readyWaiters: Array<(yt: YTNamespace) => void> = []
let scriptInjected = false

function getWindow(): WindowWithYT | null {
  if (typeof window === "undefined") return null
  return window as WindowWithYT
}

function ensureScript(win: WindowWithYT): Promise<YTNamespace> {
  return new Promise((resolve) => {
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
        document.head.appendChild(tag)
      }
      const prior = win.onYouTubeIframeAPIReady
      win.onYouTubeIframeAPIReady = () => {
        prior?.()
        const yt = win.YT
        if (!yt) return
        for (const w of readyWaiters.splice(0)) w(yt)
      }
    }
    readyWaiters.push(resolve)
  })
}

export function __resetForTests(): void {
  scriptInjected = false
  readyWaiters.length = 0
}

export interface UseYouTubePlayerResult {
  ref: (node: HTMLDivElement | null) => void
  currentTimeMs: number
  playing: boolean
  seekTo: (seconds: number) => void
}

export function useYouTubePlayer(videoId: string | null): UseYouTubePlayerResult {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!videoId || !node) {
      setCurrentTimeMs(0)
      setPlaying(false)
      return
    }
    const win = getWindow()
    if (!win) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const run = async () => {
      const yt = await ensureScript(win)
      if (cancelled) return
      const player = new yt.Player(node, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { origin: win.location.origin },
        events: {
          onStateChange: (e) => {
            if (e.data === yt.PlayerState.PLAYING) setPlaying(true)
            else if (e.data === yt.PlayerState.PAUSED || e.data === yt.PlayerState.ENDED) setPlaying(false)
          },
        },
      })
      playerRef.current = player
      intervalId = setInterval(() => {
        const current = playerRef.current
        if (!current) return
        const seconds = current.getCurrentTime()
        setCurrentTimeMs(Math.round(seconds * 1000))
      }, 100)
    }
    run()

    return () => {
      cancelled = true
      if (intervalId !== null) clearInterval(intervalId)
      const player = playerRef.current
      if (player) player.destroy()
      playerRef.current = null
      setCurrentTimeMs(0)
      setPlaying(false)
    }
  }, [videoId, node])

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current
    if (!player) return
    player.seekTo(seconds, true)
  }, [])

  return { ref: setNode, currentTimeMs, playing, seekTo }
}
