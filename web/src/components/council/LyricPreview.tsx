import { Kbd } from "@/components/Kbd"
import { LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { Bone } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { useLyricsVariant } from "@/hooks/useLyricsData"
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer"
import { youtubeThumbnailFallbackUrl } from "@/lib/artwork"
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
      <div className="grid gap-3 min-[1180px]:grid-cols-[minmax(0,1fr)_240px]">
        <div className="overflow-hidden rounded-[10px] bg-black/[0.18] shadow-[inset_0_0_0_1px_var(--color-unison-border)]">
          {variant ? (
            <LyricsRenderer
              variant={variant}
              getCurrentTime={player.getCurrentTime}
              getPlaying={player.getPlaying}
              onLineClick={playFrom}
              className="h-[360px] max-w-none px-6 [--blyrics-font-size:1.25rem] [--unison-lyric-padding:0.5rem]"
            />
          ) : (
            <Bone className="h-[360px] w-full rounded-none" />
          )}
        </div>
        <div className="aspect-video self-start overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_1px_var(--color-unison-border)]">
          {active ? (
            <div ref={player.ref} className="size-full" />
          ) : (
            <button
              type="button"
              aria-label="Play the song from the first line"
              onClick={() => playFrom(start)}
              disabled={!variant}
              className="group relative grid size-full place-items-center"
            >
              <img
                src={youtubeThumbnailFallbackUrl(videoId)}
                alt=""
                className="absolute inset-0 size-full object-cover opacity-60 transition-opacity group-hover:opacity-80"
              />
              <span className="relative grid size-10 place-items-center rounded-full bg-black/60 text-white">
                <IconPlayerPlayFilled aria-hidden className="size-4" />
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
