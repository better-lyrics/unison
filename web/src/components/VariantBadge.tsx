import { tagClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { syncTypeFor } from "@/lib/sync-type"
import type { LyricsFormat, SyncType } from "@/lib/types"
import { SyncTag } from "./SyncTag"

interface VariantBadgeProps {
  format: LyricsFormat
  syncType?: SyncType
  className?: string
}

const FORMAT_CLASS: Record<LyricsFormat, string> = {
  ttml: "text-unison-warn",
  lrc: "text-unison-text",
  plain: "text-unison-text-muted",
}

export function VariantBadge({ format, syncType, className }: VariantBadgeProps) {
  return (
    <span data-format={format} className={cn(tagClass, className)}>
      <span className={cn("tracking-wider", FORMAT_CLASS[format])}>{format.toUpperCase()}</span>
      {syncType ? (
        <>
          <span aria-hidden="true" className="text-unison-text-muted">
            ·
          </span>
          <SyncTag kind={syncTypeFor(syncType, format)} className="normal-case tracking-normal" />
        </>
      ) : null}
    </span>
  )
}
