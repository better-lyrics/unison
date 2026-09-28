import { TierChip } from "@/components/TierChip"
import { Tooltip } from "@/components/Tooltip"
import { useBadgeImage } from "@/hooks/useBadgeImage"
import { cn } from "@/lib/cn"
import type { LeaderboardBadge, TierName } from "@/lib/types"

interface BadgeStripProps {
  featured: LeaderboardBadge[]
  topBadge: LeaderboardBadge | null
  badgeCount: number
  size?: "sm" | "md"
  className?: string
}

const STRIP_SIZES = {
  sm: { gap: "gap-1", icon: "size-4", count: "text-[10px] font-medium" },
  md: { gap: "gap-1.5", icon: "size-5", count: "font-mono text-[11px] font-semibold" },
}

function useStripImages(featured: LeaderboardBadge[], topBadge: LeaderboardBadge | null) {
  const badgeImage = useBadgeImage()
  const shown = featured.length > 0 ? featured : topBadge ? [topBadge] : []
  return shown.flatMap((b) => {
    const src = badgeImage(b.key, b.tier)
    return src ? [{ badge: b, src }] : []
  })
}

export function BadgeStrip({ featured, topBadge, badgeCount, size = "md", className }: BadgeStripProps) {
  const images = useStripImages(featured, topBadge)
  const sizes = STRIP_SIZES[size]
  if (images.length === 0) return null
  const extra = featured.length > 0 ? 0 : badgeCount - 1
  return (
    <span className={cn("inline-flex items-center", sizes.gap, className)}>
      {images.map(({ badge, src }) => (
        <Tooltip key={badge.key} label={badge.name}>
          <img src={src} alt={badge.name} className={cn(sizes.icon, "object-contain")} />
        </Tooltip>
      ))}
      {extra > 0 ? <span className={cn(sizes.count, "text-unison-text-muted")}>+{extra}</span> : null}
    </span>
  )
}

interface AuthorBadgesProps {
  tier: TierName | null
  featured: LeaderboardBadge[]
  topBadge: LeaderboardBadge | null
  badgeCount: number
}

export function AuthorBadges({ tier, featured, topBadge, badgeCount }: AuthorBadgesProps) {
  const badgeImage = useBadgeImage()
  const hasStrip = useStripImages(featured, topBadge).length > 0
  if (!tier && !hasStrip) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {tier ? <TierChip tier={tier} gemSrc={badgeImage(tier) ?? undefined} /> : null}
      {hasStrip ? <BadgeStrip featured={featured} topBadge={topBadge} badgeCount={badgeCount} /> : null}
    </span>
  )
}
