import { SyncIcon } from "@/components/icons/SyncIcon"
import { cn } from "@/lib/cn"
import { SYNC_KINDS, type SyncKind } from "@/lib/sync-type"

interface SyncTagProps {
  kind: SyncKind
  size?: "tag" | "inline"
  className?: string
}

export function SyncTag({ kind, size = "inline", className }: SyncTagProps) {
  const { label, color, tint } = SYNC_KINDS[kind]
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
        "inline-flex h-[30px] select-none items-center gap-2 whitespace-nowrap rounded-[10px] pr-3 pl-2.5 text-[13px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06)] backdrop-saturate-150 [corner-shape:superellipse(1.6)]",
        className,
      )}
      style={{ color: kind === "unsynced" ? "var(--ink-2, var(--color-unison-text-secondary))" : color, background: tint }}
    >
      <SyncIcon kind={kind} />
      {label}
    </span>
  )
}
