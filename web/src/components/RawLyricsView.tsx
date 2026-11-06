import "@braccato/highlight/highlight.css"
import { highlightInto } from "@braccato/highlight"
import { useEffect, useRef } from "react"
import type { LyricsFormat } from "@/lib/types"

interface RawLyricsViewProps {
  body: string
  format: LyricsFormat
}

export function RawLyricsView({ body, format }: RawLyricsViewProps) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) highlightInto(preRef.current, body, { format, pretty: true })
  }, [body, format])

  return (
    <div className="h-[576px] overflow-auto rounded-md">
      <pre ref={preRef} className="raw-lyrics" />
    </div>
  )
}
