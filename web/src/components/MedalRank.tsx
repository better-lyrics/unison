import type { ReactNode } from "react"
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

  if (medal) {
    return (
      <RankCell title={medal.label}>
        <TrophyIcon className={cn("size-4", medal.color)} />
        <span className="sr-only">{medal.label}</span>
      </RankCell>
    )
  }
  return <RankNumber rank={rank} />
}

/** A ranked list row; on phones it bleeds by its own padding so the rank starts on the page text edge. */
export const RANK_ROW = "flex items-center gap-3 rounded-lg px-4 py-3 max-sm:-mx-4 sm:gap-4"

/** Fixed width so ranks line up; start-aligned on phones so every rank starts on the page text edge. */
export function RankCell({ title, className, children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn("inline-flex w-8 shrink-0 items-center sm:w-6 sm:justify-center", className)}>
      {children}
    </span>
  )
}

export function RankNumber({ rank }: { rank: number }) {
  return (
    <RankCell className="font-mono text-xs tabular-nums text-unison-text-muted">{formatRank(rank)}</RankCell>
  )
}
