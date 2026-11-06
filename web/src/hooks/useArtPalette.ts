import { useEffect, useState } from "react"
import { type Accent, FALLBACK_HUE, inks, sampleAccent, scrimFor } from "@/lib/accent"

const DEFAULT_SCRIM = 0.45

export function useArtPalette(src: string | null | undefined, scrimFloor = 0): Accent | null {
  const [accent, setAccent] = useState<Accent | null>(null)

  useEffect(() => {
    if (!src) return
    let live = true
    sampleAccent(src)
      .then((next) => {
        if (live) setAccent(next)
      })
      .catch((error: unknown) => console.warn("Could not sample the art palette", error))
    return () => {
      live = false
    }
  }, [src])

  useEffect(() => {
    const root = document.documentElement.style
    const vars: Record<string, string> = {
      ...inks(accent?.hue ?? FALLBACK_HUE),
      "--scrim": String(Math.max(scrimFloor, accent ? scrimFor(accent.lum) : DEFAULT_SCRIM)),
    }
    for (const [name, value] of Object.entries(vars)) root.setProperty(name, value)
    return () => {
      for (const name of Object.keys(vars)) root.removeProperty(name)
    }
  }, [accent, scrimFloor])

  return accent
}
