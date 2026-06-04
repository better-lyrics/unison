import "@braccato/core"
import type { BraccatoElement } from "@braccato/core"
import { useEffect, useRef, useState } from "react"
import type { LyricsFormat, VariantFull } from "@/lib/types"

interface LyricsRendererProps {
  variant: VariantFull
  currentTimeMs: number
  playing: boolean
  onLineClick?: (timeSeconds: number) => void
}

const MIME_BY_FORMAT: Record<LyricsFormat, string> = {
  ttml: "application/ttml+xml",
  lrc: "text/lrc",
  plain: "text/plain",
}

export function LyricsRenderer({ variant, currentTimeMs, playing, onLineClick }: LyricsRendererProps) {
  const elementRef = useRef<BraccatoElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = new Blob([variant.lyrics], { type: MIME_BY_FORMAT[variant.format] })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [variant.lyrics, variant.format])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    el.currentTime = currentTimeMs
    el.playing = playing
  }, [currentTimeMs, playing])

  const onLineClickRef = useRef(onLineClick)
  useEffect(() => {
    onLineClickRef.current = onLineClick
  })

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ time?: number }>).detail
      if (detail?.time == null) return
      onLineClickRef.current?.(detail.time / 1000)
    }
    el.addEventListener("braccato:line-click", handler)
    return () => el.removeEventListener("braccato:line-click", handler)
  }, [])

  return (
    <braccato-lyrics
      ref={elementRef}
      src={blobUrl ?? undefined}
      className="mx-auto block w-full max-w-3xl flex-1"
      style={
        {
          "--braccato-font-family": "'Satoshi', sans-serif",
          "--braccato-font-size": "1.5rem",
          "--braccato-inactive-opacity": "0.25",
        } as React.CSSProperties
      }
    />
  )
}
