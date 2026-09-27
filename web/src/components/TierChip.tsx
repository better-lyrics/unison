import { titleCase } from "@/lib/format"
import type { TierName } from "@/lib/types"
import { IconAwardFilled } from "@tabler/icons-react"

interface TierChipProps {
  tier: TierName
  rank?: number | null
  gemSrc?: string
}

export function TierChip({ tier, rank, gemSrc }: TierChipProps) {
  return (
    <span
      data-tier={tier}
      title={rank != null ? `${titleCase(tier)} · rank #${rank}` : titleCase(tier)}
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-unison-surface pr-3 pl-[7px] text-[13px] font-semibold text-unison-text shadow-[inset_0_0_0_1px_var(--color-unison-border)]"
    >
      {gemSrc ? (
        <img src={gemSrc} alt="" draggable={false} className="size-[17px] select-none" />
      ) : (
        <IconAwardFilled className="size-4 text-unison-medal-gold" />
      )}
      {titleCase(tier)}
    </span>
  )
}
