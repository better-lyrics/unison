import { Link } from "react-router-dom"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { cn } from "@/lib/cn"
import { formatRank, formatVotes } from "@/lib/format"
import type { CuratorLeaderboardEntry } from "@/lib/types"

interface CuratorRowProps {
  entry: CuratorLeaderboardEntry
  isSelf?: boolean
  appended?: boolean
}

export function CuratorRow({ entry, isSelf = false, appended = false }: CuratorRowProps) {
  const avatar = dicebearThumbsDataUri(entry.keyId)
  const href = isSelf ? "/me" : `/users/${entry.keyId}`
  return (
    <li data-self={isSelf || undefined} className={cn(appended && "!mt-4")}>
      <Link
        to={href}
        className={cn(
          "flex items-center gap-4 rounded-lg border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong",
          isSelf
            ? "border-unison-border-strong border-l-2 border-l-unison-text bg-unison-bg-hover"
            : "border-unison-border",
        )}
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(entry.rank)}</span>
        <img
          src={avatar}
          alt=""
          className="size-12 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "flex items-center gap-2 truncate text-sm text-unison-text",
              isSelf ? "font-semibold" : "font-medium",
            )}
          >
            <span className="truncate">{entry.displayName}</span>
            {isSelf ? (
              <span className="shrink-0 rounded bg-unison-text px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-unison-bg">
                You
              </span>
            ) : null}
          </p>
          <p className="truncate font-mono text-[11px] text-unison-text-muted">{entry.keyId.slice(0, 16)}…</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="font-mono text-sm text-unison-text">{entry.submissionCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">subs</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="font-mono text-sm text-unison-text">{formatVotes(entry.totalUpvotes)}</p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">upvotes</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-unison-text">{entry.score.toFixed(1)}</p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">score</p>
        </div>
      </Link>
    </li>
  )
}
