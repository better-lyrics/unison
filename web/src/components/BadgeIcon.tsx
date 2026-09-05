import { cn } from "@/lib/cn"
import { resolveBadgeImage } from "@/lib/badge-view"
import type { BadgeDef } from "@/lib/types"

type BadgeIconSize = "sm" | "md" | "lg"

const SIZE_CLASS: Record<BadgeIconSize, string> = {
  sm: "size-8",
  md: "size-12",
  lg: "size-16",
}

interface BadgeIconProps {
  badge: BadgeDef
  tier?: number
  variant?: "color" | "mono"
  earned?: boolean
  size?: BadgeIconSize
}

export function BadgeIcon({ badge, tier, variant = "color", earned = true, size = "md" }: BadgeIconProps) {
  return (
    <img
      src={resolveBadgeImage(badge, tier, variant)}
      alt={badge.name}
      draggable={false}
      className={cn(SIZE_CLASS[size], "shrink-0 select-none", !earned && "opacity-30")}
    />
  )
}
