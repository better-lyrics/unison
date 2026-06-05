import { IconMusic } from "@tabler/icons-react"
import { Link } from "react-router-dom"
import { formatCompact, formatExact, formatRank } from "@/lib/format"
import type { SongLeaderboardEntry } from "@/lib/types"

interface SongRowProps {
  entry: SongLeaderboardEntry
}

export function SongRow({ entry }: SongRowProps) {
  const metric = entry.section === "most_wanted" ? entry.demand : entry.requestCount
  const metricLabel = entry.section === "most_wanted" ? "demand" : "reports"

  return (
    <li className="overflow-hidden rounded-lg border border-unison-border bg-unison-bg-elevated transition-colors hover:border-unison-border-strong">
      <a
        href={`https://music.youtube.com/watch?v=${entry.videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${entry.song} by ${entry.artist} in YouTube Music`}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-unison-bg-hover"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(entry.rank)}</span>
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-unison-bg-hover">
          {entry.thumbnailUrl ? (
            <img src={entry.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <IconMusic className="size-6 opacity-50 text-unison-text" stroke={1.5} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-unison-text">{entry.song}</p>
          <p className="truncate text-xs text-unison-text-secondary">{entry.artist}</p>
        </div>
        <div className="text-right">
          <p title={formatExact(metric)} className="font-mono text-sm text-unison-text">
            {formatCompact(metric)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">{metricLabel}</p>
        </div>
      </a>
      <Link
        to={`/song/${entry.videoId}`}
        aria-label={`View details for ${entry.song} by ${entry.artist}`}
        className="flex justify-end border-t border-unison-border/60 px-4 py-2 text-xs text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
      >
        View details →
      </Link>
    </li>
  )
}
