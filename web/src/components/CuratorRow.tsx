import { dicebearThumbsDataUri } from "@/lib/avatar"
import { formatRank, formatVotes } from "@/lib/format"
import type { CuratorLeaderboardEntry } from "@/lib/types"

interface CuratorRowProps {
  entry: CuratorLeaderboardEntry
}

export function CuratorRow({ entry }: CuratorRowProps) {
  const avatar = dicebearThumbsDataUri(entry.keyId)
  return (
    <li className="flex items-center gap-4 rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong">
      <span className="w-10 shrink-0 font-mono text-xs text-unison-text-muted">{formatRank(entry.rank)}</span>
      <img
        src={avatar}
        alt=""
        className="size-12 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-unison-text">{entry.displayName}</p>
        <p className="truncate font-mono text-[11px] text-unison-text-muted">{entry.keyId.slice(0, 16)}…</p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="font-mono text-sm text-unison-text">{formatVotes(entry.totalUpvotes)}</p>
        <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">upvotes</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm text-unison-text">{entry.score.toFixed(1)}</p>
        <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">score</p>
      </div>
    </li>
  )
}
