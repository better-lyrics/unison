import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { LyricsContentSkeleton, LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { cn } from "@/lib/cn"
import { downloadTextFile } from "@/lib/download"
import { pickTranslationLanguage, translationLanguages } from "@/lib/lyric-translations"
import { MIME_BY_FORMAT, lyricsFilename } from "@/lib/lyrics-download"
import type { VariantFull } from "@/lib/types"
import { useMemo, useState } from "react"
import { languageName } from "@/lib/language"
import { useScrollEdges } from "@/hooks/useScrollEdges"

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
  const [pickedLang, setPickedLang] = useState<string>()
  const languages = useMemo(() => (variant ? translationLanguages(parseVariantLyrics(variant)) : []), [variant])
  const lang = pickTranslationLanguage(languages, pickedLang)
  const [pane, setPane] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(pane)
  const segment = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-unison-bg-hover text-unison-text" : "text-unison-text-muted hover:text-unison-text",
      )}
    >
      {label}
    </button>
  )
  const tab = (value: Mode, label: string) => segment(mode === value, label, () => setMode(value))
  return (
    <div className="overflow-hidden rounded-lg border border-unison-border bg-unison-bg-elevated">
      <div className="flex items-center justify-between border-b border-unison-border/60 px-3 py-2">
        <fieldset className="inline-flex rounded-md border border-unison-border bg-unison-bg p-0.5">
          <legend className="sr-only">Lyrics display mode</legend>
          {tab("synced", "Synced")}
          {tab("raw", "Raw")}
        </fieldset>
        {mode === "synced" && languages.length > 1 ? (
          <fieldset className="mr-auto ml-2 inline-flex rounded-md border border-unison-border bg-unison-bg p-0.5">
            <legend className="sr-only">Translation language</legend>
            {languages.map((code) => segment(code === lang, languageName(code), () => setPickedLang(code)))}
          </fieldset>
        ) : null}
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
      <div
        key={mode}
        ref={setPane}
        className={cn(
          "p-4 [--fb:0px] [--ft:0px] [mask-image:linear-gradient(transparent,#000_var(--ft),#000_calc(100%-var(--fb)),transparent)]",
          edges.up && "[--ft:56px]",
          edges.down && "[--fb:72px]",
        )}
      >
        {!variant ? (
          <LyricsContentSkeleton />
        ) : mode === "synced" ? (
          <LyricsRenderer
            variant={variant}
            getCurrentTime={getCurrentTime}
            getPlaying={getPlaying}
            onLineClick={onLineClick}
            translationLang={lang}
            className={lyricsClassName}
          />
        ) : (
          <RawLyricsView body={variant.lyrics} format={variant.format} />
        )}
      </div>
    </div>
  )
}
