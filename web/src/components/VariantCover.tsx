import { useArtworkCover, youtubeThumbnailFallbackUrl, youtubeThumbnailUrl } from "@/lib/artwork"
import type { VariantFull } from "@/lib/types"
import { IconPlayerPlayFilled } from "@tabler/icons-react"

function TrackHeading({ variant }: { variant: VariantFull }) {
  return (
    <div>
      <div className="truncate text-[20px] font-bold leading-tight tracking-[-0.01em] text-unison-text">
        {variant.song}
      </div>
      <div className="mt-0.5 flex min-w-0 items-baseline text-[13px]">
        <span className="min-w-0 flex-[0_1_auto] truncate text-unison-text-secondary">{variant.artist}</span>
        {variant.album ? (
          <>
            <span className="mx-1.5 shrink-0 text-unison-text-muted">·</span>
            <span className="min-w-0 flex-[0_1_auto] truncate text-unison-text-muted">{variant.album}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface CoverProps {
  variant: VariantFull
  playerRef?: (node: HTMLDivElement | null) => void
  playerActive?: boolean
  onActivatePlayer?: () => void
}

export function VariantCover({ variant, playerRef, playerActive, onActivatePlayer }: CoverProps) {
  const { data: art } = useArtworkCover(variant.videoId)

  if (playerActive) {
    return (
      <div className="aspect-square w-full overflow-hidden bg-black">
        <div ref={playerRef} className="size-full" />
      </div>
    )
  }

  const sources = art
    ? [art.url, art.fallbackUrl]
    : [youtubeThumbnailUrl(variant.videoId), youtubeThumbnailFallbackUrl(variant.videoId)]
  const poster = (
    <>
      <img
        src={sources[0] ?? undefined}
        alt=""
        onError={(e) => {
          const next = sources[1]
          if (next && e.currentTarget.src !== next) e.currentTarget.src = next
        }}
        className="block size-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_28%,rgba(19,18,23,0.82)_64%,var(--color-unison-bg-elevated)_100%)]" />
      {onActivatePlayer ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-colors group-hover:bg-black/70">
            <IconPlayerPlayFilled className="size-6 translate-x-px" />
          </span>
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-x-4 bottom-3.5">
        <TrackHeading variant={variant} />
      </div>
    </>
  )

  if (onActivatePlayer) {
    return (
      <button
        type="button"
        onClick={onActivatePlayer}
        aria-label={`Play ${variant.song}`}
        className="group relative block aspect-square w-full cursor-pointer text-left"
      >
        {poster}
      </button>
    )
  }
  return <div className="relative aspect-square w-full">{poster}</div>
}
