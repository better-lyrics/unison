import "@braccato/core"
import type { BraccatoElement } from "@braccato/core"
import { useEffect, useRef, useState } from "react"
import type { LyricsFormat, VariantFull } from "@/lib/types"

interface LyricsRendererProps {
  variant: VariantFull
  getCurrentTimeMs: () => number
  getPlaying: () => boolean
  onLineClick?: (timeSeconds: number) => void
}

const MIME_BY_FORMAT: Record<LyricsFormat, string> = {
  ttml: "application/ttml+xml",
  lrc: "text/lrc",
  plain: "text/plain",
}

export function LyricsRenderer({ variant, getCurrentTimeMs, getPlaying, onLineClick }: LyricsRendererProps) {
  const elementRef = useRef<BraccatoElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = new Blob([variant.lyrics], { type: MIME_BY_FORMAT[variant.format] })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [variant.lyrics, variant.format])

  useEffect(() => {
    let frameId: number
    const tick = () => {
      const el = elementRef.current
      if (el) {
        el.currentTime = getCurrentTimeMs()
        el.playing = getPlaying()
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [getCurrentTimeMs, getPlaying])

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
      className="mx-auto block h-[420px] w-full max-w-3xl"
      style={
        {
          "--braccato-font-family": "'Satoshi', sans-serif",
          "--braccato-font-size": "2rem",
          "--braccato-inactive-opacity": "0.2",
        } as React.CSSProperties
      }
    />
  )
}
