import { IconAwardFilled } from "@tabler/icons-react"
import { cn } from "@/lib/cn"
import type { TierName } from "@/lib/types"

interface TierChipProps {
  tier: TierName
  rank?: number | null
}

function label(tier: TierName): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

export function TierChip({ tier, rank }: TierChipProps) {
  return (
    <span
      data-tier={tier}
      title={rank != null ? `${label(tier)} · rank #${rank}` : label(tier)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-unison-border-strong bg-unison-bg-hover",
        "px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-unison-text",
      )}
    >
      <IconAwardFilled className="size-3.5 text-unison-medal-gold" />
      {label(tier)}
    </span>
  )
}
