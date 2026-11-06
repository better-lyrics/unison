import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { useArtPalette } from "@/hooks/useArtPalette"
import { FALLBACK_HUE } from "@/lib/accent"
import { sleeveHueDataUrl } from "@/lib/sleeve"
import { ArtBackground } from "./ArtBackground"

const DEFAULT_ART_SIZE = 256

interface PageArt {
  src: string | null
  moving: boolean
}

const SetPageArt = createContext<(art: PageArt | null) => void>(() => {})

export function PageArtProvider({ children }: { children: ReactNode }) {
  const [art, setArt] = useState<PageArt | null>(null)
  const fallback = useMemo(() => sleeveHueDataUrl(FALLBACK_HUE, DEFAULT_ART_SIZE), [])
  const src = art?.src ?? fallback
  useArtPalette(src)
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
