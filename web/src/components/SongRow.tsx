import { IconMusic } from "@tabler/icons-react"
import { formatRank } from "@/lib/format"
import type { SongLeaderboardEntry } from "@/lib/types"

interface SongRowProps {
  entry: SongLeaderboardEntry
}

export function SongRow({ entry }: SongRowProps) {
  const metric = entry.section === "most_wanted" ? entry.demand : entry.requestCount
  const metricLabel = entry.section === "most_wanted" ? "demand" : "reports"

  return (
    <li className="flex items-center gap-4 rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong">
      <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(entry.rank)}</span>
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-unison-bg-hover">
        {entry.thumbnailUrl ? (
          <img src={entry.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <IconMusic className="size-5 text-unison-text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-unison-text">{entry.song}</p>
        <p className="truncate text-xs text-unison-text-secondary">{entry.artist}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm text-unison-text">{metric}</p>
        <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">{metricLabel}</p>
      </div>
    </li>
  )
}
