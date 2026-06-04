import { IconMusic } from "@tabler/icons-react"
import { Link } from "react-router-dom"
import { formatDuration, formatRank } from "@/lib/format"
import type { LyricsSearchHit } from "@/lib/types"

interface SearchResultRowProps {
  entry: LyricsSearchHit
  rank: number
}

export function SearchResultRow({ entry, rank }: SearchResultRowProps) {
  const duration = formatDuration(entry.duration)
  const subline = [entry.album, duration].filter((s) => s && s.length > 0).join(" · ")
  const matchScore = entry.matchScore !== undefined ? entry.matchScore.toFixed(2) : null

  return (
    <li>
      <Link
        to={`/lyrics/${entry.videoId}?variantId=${entry.id}`}
        aria-label={`Open lyrics for ${entry.song} by ${entry.artist}`}
        className="flex items-center gap-4 rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(rank)}</span>
        <div
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-unison-bg-hover"
        >
          <IconMusic className="size-6 text-unison-text opacity-50" stroke={1.5} />
        </div>
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
