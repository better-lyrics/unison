import { useEffect, useLayoutEffect, useState } from "react"
import { type Accent, FALLBACK_HUE, inks, sampleAccent, scrimFor } from "@/lib/accent"

const DEFAULT_SCRIM = 0.45

export function useAccent(src: string | null | undefined): Accent | null {
  const [accent, setAccent] = useState<Accent | null>(null)

  useEffect(() => {
    if (!src) return
    let live = true
    sampleAccent(src)
      .then((next) => {
        if (live) setAccent(next)
      })
      .catch((error: unknown) => {
        console.warn("Could not sample the art palette", error)
        if (live) setAccent(null)
      })
    return () => {
      live = false
    }
  }, [src])

  return accent
}

export function paletteVars(accent: Accent | null, scrimFloor = 0): Record<string, string> {
  return {
    ...inks(accent?.hue ?? FALLBACK_HUE),
    "--scrim": String(Math.max(scrimFloor, accent ? scrimFor(accent.lum) : DEFAULT_SCRIM)),
  }
}

/** Applies an accent that the caller already sampled, so the text colours change in the same frame as the art. */
export function useArtPalette(accent: Accent | null, scrimFloor = 0): void {
  useLayoutEffect(() => {
    const root = document.documentElement.style
    const vars = paletteVars(accent, scrimFloor)
    for (const [name, value] of Object.entries(vars)) root.setProperty(name, value)
    return () => {
      for (const name of Object.keys(vars)) root.removeProperty(name)
    }
  }, [accent, scrimFloor])
}
