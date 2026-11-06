import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { useArtPalette } from "@/hooks/useArtPalette"
import { ArtBackground } from "./ArtBackground"

const DEFAULT_ART_SIZE = 256
const DEFAULT_SCRIM_FLOOR = 0.4
const DEFAULT_BASE = ["#0b0809", "#140a0d", "#060506"]
const DEFAULT_GLOWS = [
  { x: 0.22, y: 0.28, r: 0.6, color: "rgba(196, 28, 48, 0.5)" },
  { x: 0.82, y: 0.72, r: 0.55, color: "rgba(110, 12, 28, 0.45)" },
  { x: 0.65, y: 0.12, r: 0.35, color: "rgba(255, 86, 64, 0.18)" },
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

export function PageArtProvider({ children }: { children: ReactNode }) {
  const [art, setArt] = useState<PageArt | null>(null)
  const fallback = useMemo(defaultArt, [])
  const src = art?.src ?? fallback
  useArtPalette(src, art?.src ? 0 : DEFAULT_SCRIM_FLOOR)
  return (
    <SetPageArt value={setArt}>
      <ArtBackground src={src} moving={art?.moving ?? false} />
      {children}
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
