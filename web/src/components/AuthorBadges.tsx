import { TierChip } from "@/components/TierChip"
import { Tooltip } from "@/components/Tooltip"
import { useBadgeImage } from "@/hooks/useBadgeImage"
import type { LeaderboardBadge, TierName } from "@/lib/types"

interface AuthorBadgesProps {
  tier: TierName | null
  featured: LeaderboardBadge[]
  topBadge: LeaderboardBadge | null
  badgeCount: number
}

export function AuthorBadges({ tier, featured, topBadge, badgeCount }: AuthorBadgesProps) {
  const badgeImage = useBadgeImage()
  const topBadgeSrc = topBadge ? badgeImage(topBadge.key, topBadge.tier) : null
  if (!tier && featured.length === 0 && !topBadgeSrc) return null
  const extra = badgeCount - 1
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {tier ? <TierChip tier={tier} gemSrc={badgeImage(tier) ?? undefined} /> : null}
      {featured.length > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          {featured.map((b) => {
            const img = badgeImage(b.key, b.tier)
            return img ? (
              <Tooltip key={b.key} label={b.name}>
                <img src={img} alt={b.name} className="size-5 object-contain" />
              </Tooltip>
            ) : null
          })}
        </span>
      ) : topBadgeSrc ? (
        <span className="inline-flex items-center gap-1.5">
          <img src={topBadgeSrc} alt={topBadge?.name ?? ""} className="size-5" />
          {extra > 0 ? (
            <span className="font-mono text-[11px] font-semibold text-unison-text-muted">+{extra}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
