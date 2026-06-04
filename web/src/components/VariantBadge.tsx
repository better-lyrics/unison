import { cn } from "@/lib/cn"
import type { LyricsFormat } from "@/lib/types"

interface VariantBadgeProps {
  format: LyricsFormat
  syncType: string
}

const FORMAT_CLASS: Record<LyricsFormat, string> = {
  ttml: "text-unison-warn",
  lrc: "text-unison-text",
  plain: "text-unison-text-muted",
}

export function VariantBadge({ format, syncType }: VariantBadgeProps) {
  return (
    <span
      data-format={format}
      className="inline-flex items-center gap-1 rounded bg-unison-bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
    >
      <span className={cn("tracking-wider", FORMAT_CLASS[format])}>{format.toUpperCase()}</span>
      <span aria-hidden="true" className="text-unison-text-muted">
        ·
      </span>
      <span className="normal-case tracking-normal text-unison-text-secondary">{syncType}</span>
    </span>
  )
}
