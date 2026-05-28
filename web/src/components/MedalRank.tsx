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

  if (size === "lg") {
    if (medal) {
      return (
        <span className="inline-flex items-center gap-2" title={medal.label}>
          <TrophyIcon className={cn("size-6", medal.color)} />
          <span>{rank}</span>
          <span className="sr-only">{medal.label}</span>
        </span>
      )
    }
    return <span>{formatRank(rank)}</span>
  }

  const wrapper = "inline-flex w-10 shrink-0 items-center justify-center"
  if (medal) {
    return (
      <span className={wrapper} title={medal.label}>
        <TrophyIcon className={cn("size-4", medal.color)} />
        <span className="sr-only">{medal.label}</span>
      </span>
    )
  }
  return (
    <span className={cn(wrapper, "font-mono tabular-nums text-xs text-unison-text-muted")}>
      {formatRank(rank)}
    </span>
  )
}
