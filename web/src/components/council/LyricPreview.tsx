import { Kbd } from "@/components/Kbd"
import { LyricsPanel } from "@/components/LyricsPanel"
import { parseVariantLyrics } from "@/components/LyricsRenderer"
import { VariantCover } from "@/components/VariantMetadata"
import { Bone } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useLyricsVariant } from "@/hooks/useLyricsData"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { BlockHead } from "./detail-parts"

export function LyricPreview({ lyricId, videoId }: { lyricId: number; videoId: string }) {
  const variant = useLyricsVariant(lyricId).data?.variant
  const start = useMemo(() => {
    if (!variant) return 0
    const first = parseVariantLyrics(variant).find((line) => line.startTimeMs > 0)
    return first ? Math.max(0, first.startTimeMs / 1000 - 0.5) : 0
  }, [variant])
  const [active, setActive] = useState(false)
  const player = useYouTubePlayer(videoId, { playerVars: { autoplay: 1 } })
  const playFrom = (seconds: number) => {
    setActive(true)
    player.seekTo(seconds)
    player.play()
  }
  const toggle = () => {
    if (!active) playFrom(start)
    else if (player.getPlaying()) player.pause()
    else player.play()
  }
  useCouncilShortcuts({ p: toggle })
  const Icon = player.playing ? IconPlayerPauseFilled : IconPlayerPlayFilled

  return (
    <div>
      <BlockHead
        title="Lyric preview"
        aside={
          <button type="button" className={buttonClass("fill", "sm")} onClick={toggle} disabled={!variant}>
            <Icon aria-hidden className="size-3" />
            {player.playing ? "Pause" : "Play"}
            <Kbd keys={["P"]} />
          </button>
        }
      />
      <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-unison-border bg-unison-bg-elevated">
          {variant ? (
            <VariantCover
              variant={variant}
              playerRef={player.ref}
              playerActive={active}
              onActivatePlayer={() => playFrom(start)}
            />
          ) : (
            <Bone className="aspect-square w-full rounded-none" />
          )}
        </div>
        <LyricsPanel
          variant={variant}
          getCurrentTime={player.getCurrentTime}
          getPlaying={player.getPlaying}
          onLineClick={playFrom}
          lyricsClassName="h-[440px] [--blyrics-font-size:1.5rem]"
        />
      </div>
    </div>
  )
}
