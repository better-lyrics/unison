import { Kbd } from "@/components/Kbd"
import { LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { Bone } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useLyricsVariant } from "@/hooks/useLyricsData"
import { usePreviewClock } from "@/hooks/usePreviewClock"
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react"
import { useMemo } from "react"
import { BlockHead } from "./detail-parts"

export function LyricPreview({ lyricId }: { lyricId: number }) {
  const variant = useLyricsVariant(lyricId).data?.variant
  const start = useMemo(() => {
    if (!variant) return 0
    const first = parseVariantLyrics(variant).find((line) => line.startTimeMs > 0)
    return first ? Math.max(0, first.startTimeMs / 1000 - 0.5) : 0
  }, [variant])
  const clock = usePreviewClock(start)
  useCouncilShortcuts({ p: clock.toggle })
  const Icon = clock.playing ? IconPlayerPauseFilled : IconPlayerPlayFilled

  return (
    <div>
      <BlockHead
        title="Lyric preview"
        aside={
          <button type="button" className={buttonClass("fill", "sm")} onClick={clock.toggle} disabled={!variant}>
            <Icon aria-hidden className="size-3" />
            {clock.playing ? "Pause" : "Play"}
            <Kbd keys={["P"]} />
          </button>
        }
      />
      <div className="overflow-hidden rounded-[10px] bg-black/[0.18] shadow-[inset_0_0_0_1px_var(--color-unison-border)]">
        {variant ? (
          <LyricsRenderer
            variant={variant}
            getCurrentTime={clock.getCurrentTime}
            getPlaying={clock.getPlaying}
            className="h-[360px] max-w-none px-6 [--blyrics-font-size:1.25rem]"
          />
        ) : (
          <Bone className="h-[360px] w-full rounded-none" />
        )}
      </div>
    </div>
  )
}
