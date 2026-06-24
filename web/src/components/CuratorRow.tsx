import { IconBrandDiscordFilled } from "@tabler/icons-react"
import { Link } from "react-router-dom"
import { MedalRank } from "@/components/MedalRank"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { cn } from "@/lib/cn"
import { formatCompact, formatExact } from "@/lib/format"
import type { CuratorLeaderboardEntry } from "@/lib/types"

interface CuratorRowProps {
  entry: CuratorLeaderboardEntry
  isSelf?: boolean
  appended?: boolean
}

export function CuratorRow({ entry, isSelf = false, appended = false }: CuratorRowProps) {
  const avatar = dicebearThumbsDataUri(entry.keyId)
  const href = isSelf ? "/me" : `/curator/${entry.keyId}`
  return (
    <li data-self={isSelf || undefined} className={cn(appended && "!mt-4")}>
      <Link
        to={href}
        className={cn(
          "flex items-center gap-4 rounded-lg border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong",
          isSelf ? "border-unison-border-strong" : "border-unison-border",
        )}
      >
        <MedalRank rank={entry.rank} size="sm" />
        <img
          src={avatar}
          alt=""
          className="size-12 shrink-0 rounded-full border border-unison-border bg-unison-bg-hover"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-unison-text">
            <span className="truncate">{entry.displayName}</span>
            {entry.discordLinked ? (
              <IconBrandDiscordFilled className="size-4 shrink-0 text-unison-discord" title="Discord connected" />
            ) : null}
            {isSelf ? (
              <span className="shrink-0 rounded bg-unison-text px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-unison-bg">
                You
              </span>
            ) : null}
          </p>
          <p title={entry.keyId} className="truncate font-mono text-[11px] text-unison-text-muted">
            {`${entry.keyId.slice(0, 6)}…${entry.keyId.slice(-6)}`}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p title={formatExact(entry.submissionCount)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.submissionCount)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">subs</p>
        </div>
        <div className="hidden text-right sm:block">
          <p title={formatExact(entry.totalUpvotes)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.totalUpvotes)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">upvotes</p>
        </div>
        <div className="text-right">
          <p title={formatExact(entry.score)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.score)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-unison-text-muted">score</p>
        </div>
      </Link>
    </li>
  )
}
