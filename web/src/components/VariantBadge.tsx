import { tagClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import type { LyricsFormat } from "@/lib/types"

interface VariantBadgeProps {
  format: LyricsFormat
  syncType?: string
}

const FORMAT_CLASS: Record<LyricsFormat, string> = {
  ttml: "text-unison-warn",
  lrc: "text-unison-text",
  plain: "text-unison-text-muted",
}

export function VariantBadge({ format, syncType }: VariantBadgeProps) {
  return (
    <span data-format={format} className={tagClass}>
      <span className={cn("tracking-wider", FORMAT_CLASS[format])}>{format.toUpperCase()}</span>
      {syncType ? (
        <>
          <span aria-hidden="true" className="text-unison-text-muted">
            ·
          </span>
          <span className="normal-case tracking-normal text-unison-text-secondary">{syncType}</span>
        </>
      ) : null}
    </span>
  )
}
