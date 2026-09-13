import "@braccato/core/element"
import type { BraccatoLyricsElement, LineClickDetail } from "@braccato/core/element"
import { LRCParser, type LyricParser, PlainParser, TTMLParser } from "@braccato/parsers"
import { useEffect, useMemo, useRef } from "react"
import braccatoTheme from "@/components/braccato-theme.css?raw"
import { Bone } from "@/components/skeleton"
import { cn } from "@/lib/cn"
import type { LyricsFormat, VariantFull } from "@/lib/types"

interface LyricsRendererProps {
  variant: VariantFull
  getCurrentTime: () => number
  getPlaying: () => boolean
  onLineClick?: (timeSeconds: number) => void
}

const PARSER_BY_FORMAT: Record<LyricsFormat, LyricParser> = {
  ttml: TTMLParser,
  lrc: LRCParser,
  plain: PlainParser,
}

export function LyricsRenderer({ variant, getCurrentTime, getPlaying, onLineClick }: LyricsRendererProps) {
  const elementRef = useRef<BraccatoLyricsElement>(null)

  // No duration to hand the parser: the player reports one only once the iframe is ready, and each
  // parser keeps the lengths the document already states when it goes without.
  const lyrics = useMemo(() => PARSER_BY_FORMAT[variant.format].parse(variant.lyrics), [variant.lyrics, variant.format])

  // Ahead of the lyrics write: the theme carries the settings the lines are built against, and
  // writing it rebuilds the view.
  useEffect(() => {
    const el = elementRef.current
    if (el) el.theme = braccatoTheme
  }, [])

  useEffect(() => {
    const el = elementRef.current
    if (el) el.lyrics = lyrics
  }, [lyrics])

  useEffect(() => {
    let frameId: number
    const tick = () => {
      const el = elementRef.current
      if (el) {
        el.currentTime = getCurrentTime()
        el.playing = getPlaying()
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [getCurrentTime, getPlaying])

  const onLineClickRef = useRef(onLineClick)
  useEffect(() => {
    onLineClickRef.current = onLineClick
  })

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    const seek = (e: Event) => {
      const detail = (e as CustomEvent<LineClickDetail>).detail
      if (detail?.timeS == null) return
      onLineClickRef.current?.(detail.timeS)
    }
    // The element stopped watching its own scroller, since the scroller may be one it does not own.
    // Without this, scrolling away never pauses autoscroll and the next frame yanks the view back.
    const noteUserScroll = () => el.renderer?.noteUserScroll()
    el.addEventListener("braccato:line-click", seek)
    el.addEventListener("scroll", noteUserScroll, { passive: true })
    return () => {
      el.removeEventListener("braccato:line-click", seek)
      el.removeEventListener("scroll", noteUserScroll)
    }
  }, [])

  return <braccato-lyrics ref={elementRef} className="mx-auto h-[576px] w-full max-w-3xl" />
}

const LYRIC_SKELETON_LINES = [
  { id: "a", w: "w-3/5" },
  { id: "b", w: "w-4/5" },
  { id: "c", w: "w-1/2" },
  { id: "d", w: "w-2/3" },
  { id: "e", w: "w-3/4" },
  { id: "f", w: "w-2/5" },
  { id: "g", w: "w-3/5" },
  { id: "h", w: "w-1/2" },
  { id: "i", w: "w-11/12" },
]

export function LyricsContentSkeleton() {
  return (
    <div className="mx-auto flex h-[576px] w-full max-w-3xl flex-col justify-center gap-5">
      {LYRIC_SKELETON_LINES.map(({ id, w }) => (
        <Bone key={id} className={cn("h-5", w)} />
      ))}
    </div>
  )
}
