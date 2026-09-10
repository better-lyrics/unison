import { LyricsRenderer } from "@/components/LyricsRenderer"
import { YouTubeEmbed } from "@/components/YouTubeEmbed"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import type { ExamClip as ExamClipData } from "@/lib/examApi"
import type { VariantFull } from "@/lib/types"
import { useCallback, useMemo } from "react"

// braccato renders against a variant; the exam only has raw TTML for a clip, so
// we wrap it in the minimal shape the renderer needs.
function clipVariant(clip: ExamClipData): VariantFull {
  return {
    id: -1,
    videoId: clip.source.videoId,
    song: "",
    artist: "",
    format: "ttml",
    syncType: "richsync",
    score: 0,
    effectiveScore: 0,
    voteCount: 0,
    confidence: "high",
    hidden: false,
    lyrics: clip.ttml,
  }
}

export function ExamClip({ clip }: { clip: ExamClipData }) {
  const { ref, getCurrentTime, getPlaying, seekTo, play } = useYouTubePlayer(clip.source.videoId)
  const variant = useMemo(() => clipVariant(clip), [clip])
  const start = clip.source.start ?? 0

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

  return (
    <div className="space-y-3">
      <YouTubeEmbed playerRef={ref} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={playFromStart}
          className="cursor-pointer rounded-md bg-unison-bg-elevated px-3 py-1.5 text-xs font-medium text-unison-text transition-colors hover:bg-unison-bg-hover"
        >
          Play clip
        </button>
      </div>
      <div className="overflow-hidden rounded-lg bg-white/[0.02] p-3">
        <LyricsRenderer
          variant={variant}
          getCurrentTime={getCurrentTime}
          getPlaying={getPlaying}
          onLineClick={handleLineClick}
        />
      </div>
    </div>
  )
}
