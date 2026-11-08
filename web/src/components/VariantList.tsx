import { SyncTag } from "@/components/SyncTag"
import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { formatRank } from "@/lib/format"
import { syncTypeFor } from "@/lib/sync-type"
import type { VariantSummary } from "@/lib/types"

interface VariantListProps {
  variants: VariantSummary[]
  selectedId: number
  onSelect: (id: number) => void
}

export function VariantList({ variants, selectedId, onSelect }: VariantListProps) {
  return (
    <ul className="flex flex-col gap-1">
      {variants.map((variant, index) => {
        const isSelected = variant.id === selectedId
        const submitter = variant.submitter
        return (
          <li key={variant.id}>
            <button
              type="button"
              aria-current={isSelected ? "true" : undefined}
              onClick={() => onSelect(variant.id)}
              className={cn(
                "-mx-3 grid w-[calc(100%+1.5rem)] cursor-pointer grid-cols-[22px_32px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-unison-border-strong",
                isSelected
                  ? "bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "hover:bg-white/[0.08]",
              )}
            >
              <span className="font-mono text-xs tabular-nums text-(--ink-3)">{formatRank(index + 1)}</span>
              {submitter ? (
                <UserAvatar
                  avatarUrl={submitter.avatarUrl}
                  keyId={submitter.keyId}
                  loading="lazy"
                  className="size-8 rounded-full object-cover outline outline-1 -outline-offset-1 outline-white/10"
                />
              ) : (
                <span className="size-8 rounded-full bg-white/[0.08]" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold">{submitter?.displayName ?? "Anonymous"}</span>
                <SyncTag kind={syncTypeFor(variant.syncType, variant.format)} className="mt-0.5 text-xs" />
              </span>
              <span className="text-right">
                <span className="block font-mono text-[13px] font-bold tabular-nums">
                  {variant.effectiveScore.toFixed(1)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-(--ink-3)">
                  {`${variant.voteCount} votes`}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
