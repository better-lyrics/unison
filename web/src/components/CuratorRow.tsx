import { IconBrandDiscordFilled, IconStarFilled } from "@tabler/icons-react"
import { Link } from "react-router-dom"
import { useBadgeCatalogueOptional } from "@/components/BadgeCatalogueContext"
import { MedalRank } from "@/components/MedalRank"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { resolveBadgeImage } from "@/lib/badge-view"
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

  const catalogue = useBadgeCatalogueOptional()
  const cat = catalogue?.status === "success" ? catalogue.data : null
  const badgeImage = (key: string, tier?: number) => {
    const def = cat?.badges.find((d) => d.key === key)
    return def ? resolveBadgeImage(def, tier, "color") : null
  }
  const podium = !entry.community && entry.rank >= 1 && entry.rank <= 3
  const rankGem = podium && entry.tier ? badgeImage(entry.tier) : null
  const topBadgeImage = entry.topBadge ? badgeImage(entry.topBadge.key, entry.topBadge.tier) : null
  const extraBadges = (entry.badgeCount ?? 0) - 1

  return (
    <li data-self={isSelf || undefined} className={cn(appended && "!mt-4")}>
      <Link
        to={href}
        className={cn(
          "flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-unison-bg-hover",
          isSelf ? "bg-white/[0.06]" : "bg-white/[0.02]",
        )}
      >
        {entry.community ? (
          <span className="inline-flex w-10 shrink-0 items-center justify-center" title="Community account">
            <IconStarFilled className="size-4 text-unison-medal-gold" />
            <span className="sr-only">Community account</span>
          </span>
        ) : rankGem ? (
          <span className="inline-flex w-10 shrink-0 items-center justify-center" title={`Rank ${entry.rank}`}>
            <img src={rankGem} alt="" className="size-6 object-contain" />
            <span className="sr-only">Rank {entry.rank}</span>
          </span>
        ) : (
          <MedalRank rank={entry.rank} size="sm" />
        )}
        <span className="relative size-12 shrink-0">
          <img
            src={avatar}
            alt=""
            className="block size-12 rounded-full border border-unison-border bg-unison-bg-hover"
            loading="lazy"
          />
          {entry.discordLinked ? (
            <span
              title="Discord connected"
              className="absolute -right-0.5 -bottom-0.5 z-10 grid size-[18px] place-items-center rounded-full border-2 border-unison-bg bg-[#5865f2]"
            >
              <IconBrandDiscordFilled className="size-2.5 text-white" />
              <span className="sr-only">Discord connected</span>
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-unison-text">
            <span className="truncate">{entry.displayName}</span>
            {topBadgeImage ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <img
                  src={topBadgeImage}
                  alt={entry.topBadge?.name ?? ""}
                  title={entry.topBadge?.name}
                  className="size-4 object-contain"
                />
                {extraBadges > 0 ? (
                  <span className="text-[10px] font-medium text-unison-text-muted">+{extraBadges}</span>
                ) : null}
              </span>
            ) : null}
            {isSelf ? (
              <span className="shrink-0 rounded bg-unison-text px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-unison-bg">
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
          <p className="text-[10px] tracking-wider text-unison-text-muted">subs</p>
        </div>
        <div className="hidden text-right sm:block">
          <p title={formatExact(entry.totalUpvotes)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.totalUpvotes)}
          </p>
          <p className="text-[10px] tracking-wider text-unison-text-muted">upvotes</p>
        </div>
        <div className="text-right">
          <p title={formatExact(entry.score)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.score)}
          </p>
          <p className="text-[10px] tracking-wider text-unison-text-muted">score</p>
        </div>
      </Link>
    </li>
  )
}
