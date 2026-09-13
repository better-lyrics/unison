import { LyricsRenderer } from "@/components/LyricsRenderer"
import { YouTubeEmbed } from "@/components/YouTubeEmbed"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { cn } from "@/lib/cn"
import type { ClipAssets, ExamRendering } from "@/lib/examApi"
import type { VariantFull } from "@/lib/types"
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconReload } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { clampToWindow, reachedWindowEnd, shouldRestart } from "./clip-window"
import { examButtonPrimary, examButtonSecondary } from "./exam-ui"

// Native controls off so the candidate cannot scrub or roam the whole video.
const EXAM_PLAYER_VARS: Record<string, number> = {
  controls: 0,
  disablekb: 1,
  fs: 0,
  modestbranding: 1,
  rel: 0,
  playsinline: 1,
  iv_load_policy: 3,
}

// braccato renders against a variant; wrap the clip's raw TTML in the minimal shape it needs.
function renderingVariant(videoId: string, r: ExamRendering): VariantFull {
  return {
    id: -1,
    videoId,
    song: "",
    artist: "",
    format: "ttml",
    syncType: "richsync",
    score: 0,
    effectiveScore: 0,
    voteCount: 0,
    confidence: "high",
    hidden: false,
    lyrics: r.ttml,
  }
}

// One video drives one or more renderings off the same clock; two render side by side (A-vs-B).
export function ExamClip({ clip }: { clip: ClipAssets }) {
  const { ref, getCurrentTime, getPlaying, seekTo, play, pause } = useYouTubePlayer(clip.source.videoId, {
    playerVars: EXAM_PLAYER_VARS,
  })
  const start = clip.source.start ?? 0
  const end = clip.source.end
  const variants = useMemo(
    () => clip.renderings.map((r) => ({ r, variant: renderingVariant(clip.source.videoId, r) })),
    [clip],
  )

  const [playing, setPlaying] = useState(false)

  // Our button is the sole transport; resume in place inside the window, restart only when outside.
  const toggle = useCallback(() => {
    if (getPlaying()) {
      pause()
      setPlaying(false)
      return
    }
    if (shouldRestart(getCurrentTime(), start, end)) seekTo(start)
    play()
    setPlaying(true)
  }, [getPlaying, pause, getCurrentTime, seekTo, play, start, end])

  const handleLineClick = useCallback(
    (seconds: number) => {
      seekTo(clampToWindow(seconds, start, end))
      play()
      setPlaying(true)
    },
    [seekTo, play, start, end],
  )

  const restart = useCallback(() => {
    seekTo(start)
    play()
    setPlaying(true)
  }, [seekTo, play, start])

  // Poll because the iframe API has no reliable time event: stop the clip at its window end.
  useEffect(() => {
    const id = setInterval(() => {
      const isPlaying = getPlaying()
      if (isPlaying && end !== undefined && reachedWindowEnd(getCurrentTime(), end)) {
        pause()
        setPlaying(false)
      } else {
        setPlaying(isPlaying)
      }
    }, 150)
    return () => clearInterval(id)
  }, [end, getPlaying, getCurrentTime, pause])

  const sideBySide = variants.length > 1

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-xs space-y-3">
        <div className="relative">
          <YouTubeEmbed playerRef={ref} />
          {/* Swallow video clicks so play/pause always routes through our transport. */}
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause clip" : "Play clip"}
            className="absolute inset-0 cursor-pointer"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={toggle} className={cn(examButtonPrimary, "flex-1 gap-2")}>
            {playing ? <IconPlayerPauseFilled className="size-3.5" /> : <IconPlayerPlayFilled className="size-3.5" />}
            {playing ? "Pause clip" : "Play clip"}
          </button>
          <button
            type="button"
            onClick={restart}
            className={cn(examButtonSecondary, "gap-2")}
            aria-label="Start clip over"
          >
            <IconReload className="size-3.5" />
            Start over
          </button>
        </div>
      </div>

      <div className={cn("grid gap-4", sideBySide && "sm:grid-cols-2")}>
        {variants.map(({ r, variant }) => (
          <div
            key={`${clip.source.videoId}:${start}:${r.id}`}
            className="exam-lyrics space-y-2 rounded-lg bg-white/[0.02] p-3"
          >
            {r.label ? <p className="text-xs font-semibold text-unison-text-muted">{r.label}</p> : null}
            <LyricsRenderer
              variant={variant}
              getCurrentTime={getCurrentTime}
              getPlaying={getPlaying}
              onLineClick={handleLineClick}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
