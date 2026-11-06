import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { LyricsContentSkeleton, LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { glassClass } from "@/components/ui"
import { cn } from "@/lib/cn"
import { downloadTextFile } from "@/lib/download"
import { pickTranslationLanguage, translationLanguages } from "@/lib/lyric-translations"
import { MIME_BY_FORMAT, lyricsFilename } from "@/lib/lyrics-download"
import type { VariantFull } from "@/lib/types"
import { motion } from "motion/react"
import { useMemo, useState } from "react"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import { languageName } from "@/lib/language"
import { useScrollEdges } from "@/hooks/useScrollEdges"

const TOOL_CLASS = cn(
  glassClass,
  "relative inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[10px] px-3 [corner-shape:superellipse(1.6)] backdrop-blur-[12px] text-xs font-medium text-(--ink-2,var(--color-unison-text-secondary)) transition-[color,background-color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/[0.08] hover:text-unison-text after:absolute after:inset-x-0 after:-inset-y-0.5 active:not-disabled:scale-[0.96]",
)

const SEGMENTS_CLASS = cn(glassClass, "inline-flex rounded-[10px] p-[3px] backdrop-blur-[12px] [corner-shape:superellipse(1.6)]")

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
  const segment = (group: string, active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative h-6 cursor-pointer rounded-[7px] px-3 text-xs [corner-shape:superellipse(1.6)] after:absolute after:inset-x-0 after:-inset-y-[5px] font-medium transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        active ? "text-unison-text" : "text-(--ink-3,var(--color-unison-text-muted)) hover:text-unison-text",
      )}
    >
      {active ? (
        <motion.span
          layoutId={group}
          transition={LAYOUT_TRANSITION}
          style={{ borderRadius: 7 }}
          className="absolute inset-0 bg-white/[0.14] [corner-shape:superellipse(1.6)]"
        />
      ) : null}
      <span className="relative">{label}</span>
    </button>
  )
  const tab = (value: Mode, label: string) => segment("lyrics-mode", mode === value, label, () => setMode(value))
  return (
    <div className="group/lyrics relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-1.5 opacity-0 transition-opacity duration-150 ease-out group-focus-within/lyrics:pointer-events-auto group-focus-within/lyrics:opacity-100 group-hover/lyrics:pointer-events-auto group-hover/lyrics:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <fieldset className={SEGMENTS_CLASS}>
          <legend className="sr-only">Lyrics display mode</legend>
          {tab("synced", "Synced")}
          {tab("raw", "Raw")}
        </fieldset>
        {mode === "synced" && languages.length > 1 ? (
          <fieldset className={cn(SEGMENTS_CLASS, "t-reveal")}>
            <legend className="sr-only">Translation language</legend>
            {languages.map((code) =>
              segment("lyrics-language", code === lang, languageName(code), () => setPickedLang(code)),
            )}
          </fieldset>
        ) : null}
        {variant ? (
          <div className="ml-auto flex items-center gap-1.5">
            <CopyButton text={variant.lyrics} className={TOOL_CLASS} iconClassName="size-4" radius={10} withText />
            <DownloadButton
              onClick={() => downloadTextFile(lyricsFilename(variant), variant.lyrics, MIME_BY_FORMAT[variant.format])}
              className={TOOL_CLASS}
              iconClassName="size-4"
              withText
            />
          </div>
        ) : null}
      </div>
      <div
        key={`${mode}:${variant ? "ready" : "loading"}`}
        ref={setPane}
        className={cn(
          "lyrics-pane [text-shadow:none] [mask-image:linear-gradient(transparent,#000_var(--ft),#000_calc(100%-var(--fb)),transparent)]",
          edges.up && "[--ft:56px]",
          edges.down && "[--fb:72px]",
        )}
      >
        {!variant ? (
          <LyricsContentSkeleton className={lyricsClassName} />
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
          <RawLyricsView body={variant.lyrics} format={variant.format} className={lyricsClassName} />
        )}
      </div>
    </div>
  )
}
