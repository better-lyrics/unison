import { Link } from "react-router-dom"
import { Bone } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { tagClass } from "@/components/ui"
import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { formatElapsed } from "@/lib/format"
import type { FeedEntry } from "@/lib/types"

type SealedTileVariant = "shelf" | "card"

const FRAME: Record<SealedTileVariant, string> = {
  shelf: "flex w-[148px] shrink-0 flex-col gap-2",
  card: "flex flex-col overflow-hidden rounded-xl bg-white/[0.02]",
}

const SYNC_LABEL: Partial<Record<FeedEntry["syncType"], string>> = {
  richsync: "Word synced",
  linesync: "Line synced",
}

interface SealedTileProps {
  entry: FeedEntry
  variant: SealedTileVariant
  now?: number
}

export function SealedTile({ entry, variant, now = Math.floor(Date.now() / 1000) }: SealedTileProps) {
  const seal = entry.marks?.find((mark) => mark.type === "seal")
  const isCard = variant === "card"
  const syncLabel = SYNC_LABEL[entry.syncType]
  const submitter = entry.submitter ? (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-unison-text-muted">
      <UserAvatar
        avatarUrl={entry.submitter.avatarUrl}
        keyId={entry.submitter.keyId}
        className="size-4 shrink-0 rounded-full"
        loading="lazy"
      />
      <span className="truncate">{entry.submitter.displayName}</span>
    </span>
  ) : null

  return (
    <Link
      to={`/song/${entry.videoId}`}
      aria-label={`${entry.song} by ${entry.artist}`}
      className={cn(FRAME[variant], "group transition-opacity hover:opacity-90")}
    >
      <div className="relative">
        <SongThumbnail
          videoId={entry.videoId}
          className={cn("aspect-square w-full", isCard ? "rounded-none" : "rounded-[10px]")}
        />
        {seal ? (
          <img
            src={seal.icon}
            alt=""
            className={cn(
              "absolute -rotate-6 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]",
              isCard ? "right-2 bottom-2 size-[30px]" : "right-1.5 bottom-1.5 size-[26px]",
            )}
          />
        ) : null}
      </div>
      <div className={cn("flex min-w-0 flex-col", isCard ? "gap-1.5 px-3 pt-2.5 pb-3" : "gap-1")}>
        <span className={cn("truncate font-medium text-unison-text", isCard ? "text-sm" : "text-[13px]")}>
          {entry.song}
        </span>
        <span className="-mt-1 truncate text-xs text-unison-text-secondary">{entry.artist}</span>
        {isCard ? (
          <>
            {syncLabel ? <span className={cn(tagClass, "w-fit")}>{syncLabel}</span> : null}
            <span className="flex items-center justify-between gap-2">
              {submitter ?? <span />}
              {seal?.at !== undefined ? (
                <span className="shrink-0 font-mono text-[11px] text-unison-text-muted tabular-nums">
                  {formatElapsed(now - seal.at)} ago
                </span>
              ) : null}
            </span>
          </>
        ) : (
          submitter
        )}
      </div>
    </Link>
  )
}

export function SealedTileSkeleton({ variant }: { variant: SealedTileVariant }) {
  const isCard = variant === "card"
  return (
    <div aria-hidden="true" className={FRAME[variant]}>
      <Bone className={cn("aspect-square w-full", isCard ? "rounded-none" : "rounded-[10px]")} />
      <div className={cn("flex flex-col", isCard ? "gap-2 px-3 pt-2.5 pb-3" : "gap-2")}>
        <Bone className="h-3.5 w-3/4" />
        <Bone className="h-3 w-1/2" />
        {isCard ? <Bone className="h-4 w-20 rounded" /> : null}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Bone className="size-4 rounded-full" />
            <Bone className="h-2.5 w-12" />
          </div>
          {isCard ? <Bone className="h-2.5 w-8" /> : null}
        </div>
      </div>
    </div>
  )
}
