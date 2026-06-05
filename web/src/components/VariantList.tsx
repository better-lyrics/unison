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
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-unison-border-strong",
                isSelected
                  ? "border-unison-border-strong bg-unison-bg-hover"
                  : "border-unison-border bg-unison-bg-elevated hover:border-unison-border-strong hover:bg-unison-bg-hover",
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
