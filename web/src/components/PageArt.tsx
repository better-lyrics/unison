import { createContext, type FocusEvent, type PointerEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useArtPalette } from "@/hooks/useArtPalette"
import { songBackdrop, useArtwork } from "@/lib/artwork"
import { ArtBackground } from "./ArtBackground"

const DEFAULT_ART_SIZE = 256
const PREVIEW_ENTER_MS = 200
const PREVIEW_LEAVE_MS = 400
const DEFAULT_SCRIM_FLOOR = 0.3
const DEFAULT_BASE = ["#050505", "#070606", "#040404"]
const DEFAULT_GLOWS = [
  { x: 0.18, y: 0.22, r: 0.3, color: "rgba(235, 24, 46, 1)" },
  { x: 0.82, y: 0.68, r: 0.26, color: "rgba(210, 16, 38, 1)" },
  { x: 0.55, y: 0.92, r: 0.18, color: "rgba(255, 52, 64, 0.9)" },
]

function defaultArt(): string | null {
  const size = DEFAULT_ART_SIZE
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size })
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const base = ctx.createLinearGradient(0, 0, size, size)
  DEFAULT_BASE.forEach((color, i) => base.addColorStop(i / (DEFAULT_BASE.length - 1), color))
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (const glow of DEFAULT_GLOWS) {
    const radial = ctx.createRadialGradient(glow.x * size, glow.y * size, 0, glow.x * size, glow.y * size, glow.r * size)
    radial.addColorStop(0, glow.color)
    radial.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = radial
    ctx.fillRect(0, 0, size, size)
  }
  return canvas.toDataURL("image/png")
}

interface PageArt {
  src: string | null
  moving: boolean
}

const SetPageArt = createContext<(art: PageArt | null) => void>(() => {})
const PreviewPageArt = createContext<(src: string | null) => void>(() => {})

export function PageArtProvider({ children }: { children: ReactNode }) {
  const [art, setArt] = useState<PageArt | null>(null)
  const [preview, setPreview] = useState<{ src: string | null; pathname: string } | null>(null)
  const previewTimer = useRef<number | undefined>(undefined)
  const { pathname } = useLocation()
  const fallback = useMemo(defaultArt, [])
  const src = art?.src ?? fallback
  const [onScreen, setOnScreen] = useState<string | null>(null)
  const paletteSrc = onScreen ?? src
  useArtPalette(paletteSrc, paletteSrc === fallback ? DEFAULT_SCRIM_FLOOR : 0)

  const previewSrc = preview?.pathname === pathname ? preview.src : null

  const previewArt = useCallback(
    (next: string | null) => {
      window.clearTimeout(previewTimer.current)
      previewTimer.current = window.setTimeout(
        () => setPreview({ src: next, pathname }),
        next ? PREVIEW_ENTER_MS : PREVIEW_LEAVE_MS,
      )
    },
    [pathname],
  )

  return (
    <SetPageArt value={setArt}>
      <PreviewPageArt value={previewArt}>
        <ArtBackground src={previewSrc ?? src} moving={art?.moving ?? false} onShow={setOnScreen} />
        {children}
      </PreviewPageArt>
    </SetPageArt>
  )
}

export function usePageArt(src: string | null | undefined, moving = false) {
  const setArt = useContext(SetPageArt)
  useEffect(() => {
    setArt({ src: src ?? null, moving })
  }, [setArt, src, moving])
  useEffect(() => () => setArt(null), [setArt])
}

export function useSongArtPreview({ videoId, song, artist }: { videoId: string; song: string; artist: string }) {
  const previewArt = useContext(PreviewPageArt)
  const { data: cover } = useArtwork(videoId)
  const active = useRef(false)
  const show = () => {
    active.current = true
    previewArt(songBackdrop(videoId, Boolean(cover), song, artist))
  }
  const hide = () => {
    active.current = false
    previewArt(null)
  }
  useEffect(
    () => () => {
      if (active.current) previewArt(null)
    },
    [previewArt],
  )
  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") show()
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") hide()
    },
    onFocus: (e: FocusEvent) => {
      if (e.currentTarget.matches(":focus-visible")) show()
    },
    onBlur: hide,
  }
}
