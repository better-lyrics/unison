import { BadgeStrip } from "@/components/AuthorBadges"
import { MedalRank, RANK_ROW, RankCell } from "@/components/MedalRank"
import { UserAvatar } from "@/components/UserAvatar"
import { DiscordIcon } from "@/components/icons/DiscordIcon"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { useBadgeArt } from "@/hooks/useBadgeImage"
import { BadgeArt } from "@/components/BadgeArt"
import { cn } from "@/lib/cn"
import { formatCompact, formatExact } from "@/lib/format"
import type { CuratorLeaderboardEntry } from "@/lib/types"
import { IconStarFilled } from "@tabler/icons-react"
import { Link } from "react-router-dom"

interface CuratorRowProps {
  entry: CuratorLeaderboardEntry
  isSelf?: boolean
  appended?: boolean
}

export function CuratorRow({ entry, isSelf = false, appended = false }: CuratorRowProps) {
  const href = isSelf ? "/me" : `/curator/${entry.keyId}`

  const badgeArt = useBadgeArt()
  const podium = !entry.community && entry.rank >= 1 && entry.rank <= 3
  const rankGem = podium && entry.tier ? badgeArt(entry.tier) : null

  return (
    <li data-self={isSelf || undefined} className={cn(appended && "!mt-4")}>
      <Link
        to={href}
        className={cn(
          RANK_ROW,
          "transition-colors hover:bg-unison-bg-hover",
          isSelf ? "bg-white/[0.06]" : "sm:bg-white/[0.02]",
        )}
      >
        {entry.community ? (
          <RankCell title="Community account">
            <IconStarFilled className="size-4 text-unison-medal-gold" />
            <span className="sr-only">Community account</span>
          </RankCell>
        ) : rankGem ? (
          <RankCell title={`Rank ${entry.rank}`}>
            <BadgeArt src={rankGem.src} silhouette={rankGem.silhouette} className="size-6" />
            <span className="sr-only">Rank {entry.rank}</span>
          </RankCell>
        ) : (
          <MedalRank rank={entry.rank} size="sm" />
        )}
        <span className="relative size-12 shrink-0">
          <UserAvatar
            avatarUrl={entry.avatarUrl}
            keyId={entry.keyId}
            className="block size-12 rounded-full border border-unison-border bg-unison-bg-hover"
            loading="lazy"
          />
          {entry.discordLinked ? (
            <span
              title="Discord connected"
              className="absolute -right-0.5 -bottom-0.5 z-10 grid size-[18px] place-items-center rounded-full border-2 border-unison-bg bg-[#5865f2]"
            >
              <DiscordIcon className="size-2.5 text-white" />
              <span className="sr-only">Discord connected</span>
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-unison-text sm:flex-nowrap">
            <span className="min-w-0 truncate">{entry.displayName}</span>
            {isSelf ? (
              <span className="shrink-0 rounded bg-unison-text px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-unison-bg sm:order-last">
                You
              </span>
            ) : null}
            <BadgeStrip
              size="sm"
              featured={entry.featured ?? []}
              topBadge={entry.topBadge ?? null}
              badgeCount={entry.badgeCount ?? 0}
              className="mt-1 w-full shrink-0 sm:mt-0 sm:w-auto"
            />
          </p>
          <p title={entry.keyId} className="hidden truncate font-mono text-[11px] text-unison-text-muted sm:block">
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
        <div className="max-sm:w-12 max-sm:shrink-0 text-right">
          <p title={formatExact(entry.score)} className="font-mono text-sm text-unison-text">
            {formatCompact(entry.score)}
          </p>
          <p className="text-[10px] tracking-wider text-unison-text-muted">score</p>
        </div>
      </Link>
    </li>
  )
}

function CuratorStatSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("max-sm:w-12 max-sm:shrink-0 flex-col items-end gap-1.5 text-right", className)}>
      <Bone className="h-3.5 w-8" />
      <Bone className="h-2.5 w-10" />
    </div>
  )
}

function CuratorRowSkeleton() {
  return (
    <li>
      <div className={cn(RANK_ROW, "sm:bg-white/[0.02]")}>
        <RankCell>
          <Bone className="size-6 rounded-full" />
        </RankCell>
        <Bone className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-3.5 w-1/3" />
          <Bone className="h-2.5 w-24" />
        </div>
        <CuratorStatSkeleton className="hidden sm:flex" />
        <CuratorStatSkeleton className="hidden sm:flex" />
        <CuratorStatSkeleton className="flex" />
      </div>
    </li>
  )
}

export function CuratorRowSkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {skeletonKeys("curator-skeleton", rows).map((key) => (
        <CuratorRowSkeleton key={key} />
      ))}
    </ul>
  )
}
