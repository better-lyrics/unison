import { IconAwardFilled } from "@tabler/icons-react"
import type { TierName } from "@/lib/types"

interface TierChipProps {
  tier: TierName
  rank?: number | null
  gemSrc?: string
}

function label(tier: TierName): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

export function TierChip({ tier, rank, gemSrc }: TierChipProps) {
  return (
    <span
      data-tier={tier}
      title={rank != null ? `${label(tier)} · rank #${rank}` : label(tier)}
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-unison-surface pr-3 pl-[7px] text-[13px] font-semibold text-unison-text shadow-[inset_0_0_0_1px_var(--color-unison-border)]"
    >
      {gemSrc ? (
        <img src={gemSrc} alt="" draggable={false} className="size-[17px] select-none" />
      ) : (
        <IconAwardFilled className="size-4 text-unison-medal-gold" />
      )}
      {label(tier)}
    </span>
  )
}
