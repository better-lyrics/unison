import { SyncIcon } from "@/components/icons/SyncIcon"
import { cn } from "@/lib/cn"
import { SYNC_KINDS, type SyncKind } from "@/lib/sync-type"

interface SyncTagProps {
  kind: SyncKind
  size?: "tag" | "inline"
  className?: string
}

function tagSurface(color: string, chroma: number) {
  return {
    background: `linear-gradient(180deg, oklch(from ${color} 0.46 ${0.08 * chroma} h / 0.55), oklch(from ${color} 0.4 ${0.06 * chroma} h / 0.5)), rgba(15, 14, 19, 0.2)`,
    boxShadow: `inset 0 1px 0 oklch(from ${color} 0.65 ${0.1 * chroma} h / 0.45)`,
  }
}

export function SyncTag({ kind, size = "inline", className }: SyncTagProps) {
  const { label, color } = SYNC_KINDS[kind]
  if (size === "inline") {
    return (
      <span
        className={cn("inline-flex items-center gap-[5px] whitespace-nowrap font-bold", className)}
        style={{ color }}
      >
        <SyncIcon kind={kind} size={12} />
        {label}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex h-[30px] select-none items-center gap-2 whitespace-nowrap rounded-[10px] pr-3 pl-2.5 text-[13px] font-bold [corner-shape:superellipse(1.6)]",
        className,
      )}
      style={{ color: kind === "unsynced" ? "var(--ink-2, var(--color-unison-text-secondary))" : color, ...tagSurface(color, kind === "unsynced" ? 0 : 1) }}
    >
      <SyncIcon kind={kind} />
      {label}
    </span>
  )
}
