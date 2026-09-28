import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { LyricsContentSkeleton, LyricsRenderer } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { cn } from "@/lib/cn"
import { downloadTextFile } from "@/lib/download"
import { MIME_BY_FORMAT, lyricsFilename } from "@/lib/lyrics-download"
import type { VariantFull } from "@/lib/types"
import { useState } from "react"

const HEADER_ACTION_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-unison-border bg-unison-bg-elevated px-2 py-1 text-xs text-unison-text-secondary transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover hover:text-unison-text"

type Mode = "synced" | "raw"

interface LyricsPanelProps {
  variant: VariantFull | undefined
  getCurrentTime: () => number
  getPlaying: () => boolean
  onLineClick: (seconds: number) => void
  lyricsClassName?: string
}

export function LyricsPanel({ variant, getCurrentTime, getPlaying, onLineClick, lyricsClassName }: LyricsPanelProps) {
  const [mode, setMode] = useState<Mode>("synced")
  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cn(
        "cursor-pointer rounded px-3 py-1 text-xs font-medium transition-colors",
        mode === value ? "bg-unison-bg-hover text-unison-text" : "text-unison-text-muted hover:text-unison-text",
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="overflow-hidden rounded-lg border border-unison-border bg-unison-bg-elevated">
      <div className="flex items-center justify-between border-b border-unison-border/60 px-3 py-2">
        <fieldset className="inline-flex rounded-md border border-unison-border bg-unison-bg p-0.5">
          <legend className="sr-only">Lyrics display mode</legend>
          {tab("synced", "Synced")}
          {tab("raw", "Raw")}
        </fieldset>
        {variant ? (
          <div className="flex items-center gap-2">
            <DownloadButton
              onClick={() => downloadTextFile(lyricsFilename(variant), variant.lyrics, MIME_BY_FORMAT[variant.format])}
              className={HEADER_ACTION_CLASS}
              iconClassName="size-3.5"
              withText
            />
            <CopyButton text={variant.lyrics} className={HEADER_ACTION_CLASS} iconClassName="size-3.5" withText />
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {!variant ? (
          <LyricsContentSkeleton />
        ) : mode === "synced" ? (
          <LyricsRenderer
            variant={variant}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            onLineClick={onLineClick}
            className={lyricsClassName}
          />
        ) : (
          <RawLyricsView body={variant.lyrics} format={variant.format} />
        )}
      </div>
    </div>
  )
}
