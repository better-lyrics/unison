import { Link } from "react-router-dom"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { formatDuration, formatRank } from "@/lib/format"
import type { LyricsSearchHit } from "@/lib/types"

interface SearchResultRowProps {
  entry: LyricsSearchHit
  rank: number
}

export function SearchResultRow({ entry, rank }: SearchResultRowProps) {
  const duration = formatDuration(entry.duration)
  const subline = [entry.album, duration].filter((s) => s && s.length > 0).join(" · ")
  const matchScore = entry.matchScore !== undefined && entry.matchScore < 1 ? entry.matchScore.toFixed(2) : null

  return (
    <li>
      <Link
        to={`/song/${entry.videoId}?variantId=${entry.id}`}
        aria-label={`Open lyrics for ${entry.song} by ${entry.artist}`}
        className="flex items-center gap-4 rounded-lg bg-white/[0.02] px-4 py-3 transition-colors hover:bg-unison-bg-hover"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(rank)}</span>
        <SongThumbnail videoId={entry.videoId} className="size-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-unison-text">{entry.song}</p>
          <p className="truncate text-xs text-unison-text-secondary">{entry.artist}</p>
          {subline.length > 0 ? <p className="truncate text-[11px] text-unison-text-muted">{subline}</p> : null}
          {matchScore !== null ? (
            <p className="truncate text-[11px] text-unison-text-muted">{`Lyric match · score ${matchScore}`}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded bg-unison-bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-unison-text-secondary">
            {entry.format}
          </span>
          <p className="font-mono text-sm tabular-nums text-unison-text">{entry.effectiveScore.toFixed(1)}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-unison-text-muted">
            {`${entry.voteCount} votes`}
          </p>
        </div>
      </Link>
    </li>
  )
}

function SearchResultRowSkeleton() {
  return (
    <li>
      <div className="flex items-center gap-4 rounded-lg bg-white/[0.02] px-4 py-3">
        <Bone className="h-4 w-4 shrink-0" />
        <Bone className="size-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Bone className="h-3.5 w-2/5" />
          <Bone className="h-3 w-1/4" />
          <Bone className="h-2.5 w-1/3" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Bone className="h-[18px] w-10 rounded" />
          <Bone className="h-5 w-8" />
          <Bone className="h-[14px] w-12" />
        </div>
      </div>
    </li>
  )
}

export function SearchResultRowSkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {skeletonKeys("search-skeleton", rows).map((key) => (
        <SearchResultRowSkeleton key={key} />
      ))}
    </ul>
  )
}
