import { Link } from "react-router-dom"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { SyncTag } from "@/components/SyncTag"
import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { formatCompact, formatExact, formatRelativeTime } from "@/lib/format"
import { syncTypeFor } from "@/lib/sync-type"
import type { LyricsFormat, MarkActor, SyncType } from "@/lib/types"

export const COVER_GRID = "grid grid-cols-4 gap-5 max-[1000px]:grid-cols-2 max-[1000px]:gap-4"
const OVERHANG = "-mr-[0.08em] -mb-[0.16em] pr-[0.08em] pb-[0.16em]"

export interface CoverTileSong {
  videoId: string
  song: string
  artist: string
  syncType: SyncType
  format: LyricsFormat
  createdAt: number
  voteCount?: number
  hidden?: boolean
  submitter?: MarkActor
}

export function SongCoverTile({ song: s }: { song: CoverTileSong }) {
  return (
    <li className="min-w-0">
      <Link to={`/song/${s.videoId}`} className="flex min-w-0 flex-col gap-2.5 rounded-xl">
        <SongThumbnail
          videoId={s.videoId}
          song={s.song}
          artist={s.artist}
          className="relative aspect-square w-full rounded-xl bg-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.3)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:outline after:outline-1 after:-outline-offset-1 after:outline-white/10"
        />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
            <span title={s.song} className={cn("truncate", OVERHANG)}>
              {s.song}
            </span>
            {s.hidden ? (
              <span className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-(--ink-2) [text-shadow:none]">
                hidden
              </span>
            ) : null}
          </p>
          <p title={s.artist} className={cn("mt-0.5 truncate text-xs text-(--ink-3)", OVERHANG)}>
            {s.artist}
          </p>
          <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-(--ink-dim) [text-shadow:none]">
            {s.submitter ? (
              <>
                <UserAvatar
                  avatarUrl={s.submitter.avatarUrl}
                  keyId={s.submitter.keyId}
                  className="size-4 shrink-0 rounded-full"
                  loading="lazy"
                />
                <span
                  title={`${s.submitter.displayName} · ${formatRelativeTime(s.createdAt)}`}
                  className="min-w-0 truncate"
                >
                  <span className="text-(--ink-2)">{s.submitter.displayName}</span>
                  {" · "}
                  {formatRelativeTime(s.createdAt)}
                </span>
                <SyncTag kind={syncTypeFor(s.syncType, s.format)} className="ml-auto" />
              </>
            ) : (
              <>
                <SyncTag kind={syncTypeFor(s.syncType, s.format)} />
                <span className="truncate">{formatRelativeTime(s.createdAt)}</span>
                {s.voteCount === undefined ? null : (
                  <span
                    title={`${formatExact(s.voteCount)} votes`}
                    className="ml-auto whitespace-nowrap font-mono text-[11px]"
                  >
                    {formatCompact(s.voteCount)} {s.voteCount === 1 ? "vote" : "votes"}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}

export function SongCoverTileSkeletons({ id, count }: { id: string; count: number }) {
  return (
    <ul className={COVER_GRID}>
      {skeletonKeys(id, count).map((key) => (
        <li key={key} className="flex flex-col gap-2.5">
          <Bone className="aspect-square w-full rounded-xl" />
          <Bone className="h-3.5 w-2/3" />
          <Bone className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  )
}
