import "@braccato/highlight/highlight.css"
import { highlightInto } from "@braccato/highlight"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/cn"
import type { LyricsFormat } from "@/lib/types"

interface RawLyricsViewProps {
  body: string
  format: LyricsFormat
  className?: string
}

export function RawLyricsView({ body, format, className }: RawLyricsViewProps) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) highlightInto(preRef.current, body, { format, pretty: true })
  }, [body, format])

  return (
    <div data-scroller className={cn("h-[576px] overflow-auto [scrollbar-width:none]", className)}>
      <pre ref={preRef} className="raw-lyrics" />
    </div>
  )
}
