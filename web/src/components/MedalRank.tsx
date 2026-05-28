import { TrophyIcon } from "@/components/icons/TrophyIcon"
import { cn } from "@/lib/cn"
import { formatRank } from "@/lib/format"

interface MedalRankProps {
  rank: number
  size?: "sm" | "lg"
}

const MEDAL_BY_RANK: Record<number, { color: string; label: string }> = {
  1: { color: "text-unison-medal-gold", label: "1st place" },
  2: { color: "text-unison-medal-silver", label: "2nd place" },
  3: { color: "text-unison-medal-bronze", label: "3rd place" },
}

export function MedalRank({ rank, size = "sm" }: MedalRankProps) {
  const medal = MEDAL_BY_RANK[rank]
  const wrapper = cn(
    "inline-flex shrink-0 items-center justify-center",
    size === "sm" ? "w-10" : "w-14",
  )

  if (medal) {
    const iconSize = size === "sm" ? "size-4" : "size-6"
    return (
      <span className={wrapper} title={medal.label}>
        <TrophyIcon className={cn(iconSize, medal.color)} />
        <span className="sr-only">{medal.label}</span>
      </span>
    )
  }

  const textSize = size === "sm" ? "text-xs" : "text-lg"
  return (
    <span className={cn(wrapper, "font-mono tabular-nums text-unison-text-muted", textSize)}>
      {formatRank(rank)}
    </span>
  )
}
