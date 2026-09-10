import { LyricsRenderer } from "@/components/LyricsRenderer"
import { YouTubeEmbed } from "@/components/YouTubeEmbed"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { cn } from "@/lib/cn"
import type { ClipAssets, ExamRendering } from "@/lib/examApi"
import type { VariantFull } from "@/lib/types"
import { IconPlayerPlayFilled } from "@tabler/icons-react"
import { useCallback, useMemo } from "react"
import { examButtonGhost } from "./exam-ui"

// braccato renders against a variant; a clip only has raw TTML, so wrap it in the
// minimal shape the renderer needs.
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

// One video, one or more lyric renderings driven off the same player clock. Two
// renderings render side by side (A-vs-B); one fills the width.
export function ExamClip({ clip }: { clip: ClipAssets }) {
  const { ref, getCurrentTime, getPlaying, seekTo, play } = useYouTubePlayer(clip.source.videoId)
  const start = clip.source.start ?? 0
  const variants = useMemo(
    () => clip.renderings.map((r) => ({ r, variant: renderingVariant(clip.source.videoId, r) })),
    [clip],
  )

  const playFromStart = useCallback(() => {
    seekTo(start)
    play()
  }, [seekTo, play, start])

  const handleLineClick = useCallback(
    (seconds: number) => {
      seekTo(seconds)
      play()
    },
    [seekTo, play],
  )

  const sideBySide = variants.length > 1

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-md space-y-3">
        <YouTubeEmbed playerRef={ref} />
        <button type="button" onClick={playFromStart} className={examButtonGhost}>
          <IconPlayerPlayFilled className="size-3.5" />
          Play clip
        </button>
      </div>

      <div className={cn("grid gap-4", sideBySide && "sm:grid-cols-2")}>
        {variants.map(({ r, variant }) => (
          <div key={r.id} className="space-y-2 rounded-lg bg-white/[0.02] p-3">
            {r.label ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-unison-text-muted">{r.label}</p>
            ) : null}
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
