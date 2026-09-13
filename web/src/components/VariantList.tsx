import { Bone, skeletonKeys } from "@/components/skeleton"
import { cn } from "@/lib/cn"
import { formatRank } from "@/lib/format"
import type { VariantSummary } from "@/lib/types"
import { VariantBadge } from "./VariantBadge"

interface VariantListProps {
  variants: VariantSummary[]
  selectedId: number
  onSelect: (id: number) => void
}

export function VariantList({ variants, selectedId, onSelect }: VariantListProps) {
  return (
    <ul className="space-y-2">
      {variants.map((variant, index) => {
        const isSelected = variant.id === selectedId
        return (
          <li key={variant.id}>
            <button
              type="button"
              aria-current={isSelected ? "true" : undefined}
              onClick={() => onSelect(variant.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-unison-border-strong",
                isSelected ? "bg-unison-bg-hover" : "bg-white/[0.02] hover:bg-unison-bg-hover",
              )}
            >
              <span className="shrink-0 font-mono text-xs tabular-nums text-unison-text-muted">
                {formatRank(index + 1)}
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <VariantBadge format={variant.format} syncType={variant.syncType} />
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-sm tabular-nums text-unison-text">
                  {variant.effectiveScore.toFixed(1)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-unison-text-muted">
                  {`${variant.voteCount} votes`}
                </span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function VariantListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {skeletonKeys("variant-skeleton", rows).map((key) => (
        <li key={key}>
          <div className="flex w-full items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2">
            <Bone className="h-3.5 w-4 shrink-0" />
            <Bone className="h-[18px] w-24" />
            <div className="ml-auto flex flex-col items-end gap-1">
              <Bone className="h-4 w-8" />
              <Bone className="h-2.5 w-12" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
