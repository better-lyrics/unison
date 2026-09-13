import { useCallback, useEffect, useRef, useState } from "react"

interface YTPlayer {
  getCurrentTime(): number
  getPlayerState(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void
}

const YT_STATE_PLAYING = 1

interface YTPlayerCtorOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: Record<string, string | number>
  events?: { onReady?: () => void }
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
  getCurrentTime: () => number
  getPlaying: () => boolean
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
}

export interface UseYouTubePlayerOptions {
  playerVars?: Record<string, string | number>
}

export function useYouTubePlayer(videoId: string | null, options?: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  // YT.Player methods aren't attached until onReady fires; calling one earlier
  // throws. The rAF sync loop polls every frame, so the getters must stay inert
  // until the player is ready or one throw kills the loop permanently.
  const readyRef = useRef(false)
  // A line-click mounts the player, so seek/play can arrive before onReady; hold the
  // latest request and flush it once the player is ready.
  const pendingSeekRef = useRef<number | null>(null)
  const pendingPlayRef = useRef(false)
  // Read at player creation only (the effect runs on videoId/node), so a caller may
  // pass a fresh options object each render without forcing a rebuild.
  const playerVarsRef = useRef(options?.playerVars)
  playerVarsRef.current = options?.playerVars

  useEffect(() => {
    if (!videoId || !node) return
    const win = getWindow()
    if (!win) return

    let cancelled = false
    readyRef.current = false

    const run = async () => {
      const yt = await ensureScript(win).catch(() => null)
      if (cancelled || !yt) return
      const player = new yt.Player(node, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { origin: win.location.origin, ...playerVarsRef.current },
        events: {
          onReady: () => {
            if (cancelled) return
            readyRef.current = true
            if (pendingSeekRef.current !== null) {
              player.seekTo(pendingSeekRef.current, true)
              pendingSeekRef.current = null
            }
            if (pendingPlayRef.current) {
              player.playVideo()
              pendingPlayRef.current = false
            }
          },
        },
      })
      playerRef.current = player
    }
    run()

    return () => {
      cancelled = true
      readyRef.current = false
      pendingSeekRef.current = null
      pendingPlayRef.current = false
      const player = playerRef.current
      if (player) player.destroy()
      playerRef.current = null
    }
  }, [videoId, node])

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current
    if (!player || !readyRef.current) {
      pendingSeekRef.current = seconds
      return
    }
    player.seekTo(seconds, true)
  }, [])

  const play = useCallback(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) {
      pendingPlayRef.current = true
      return
    }
    player.playVideo()
  }, [])

  const pause = useCallback(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) {
      pendingPlayRef.current = false
      return
    }
    player.pauseVideo()
  }, [])

  const getCurrentTime = useCallback(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) return 0
    return player.getCurrentTime()
  }, [])

  const getPlaying = useCallback(() => {
    const player = playerRef.current
    if (!player || !readyRef.current) return false
    return player.getPlayerState() === YT_STATE_PLAYING
  }, [])

  return { ref: setNode, getCurrentTime, getPlaying, seekTo, play, pause }
}
