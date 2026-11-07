import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { LyricsContentSkeleton, LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { glassClass } from "@/components/ui"
import { IconFocusCentered } from "@tabler/icons-react"
import { cn } from "@/lib/cn"
import { downloadTextFile } from "@/lib/download"
import { pickTranslationLanguage, translationLanguages } from "@/lib/lyric-translations"
import { MIME_BY_FORMAT, lyricsFilename } from "@/lib/lyrics-download"
import type { VariantFull } from "@/lib/types"
import { motion } from "motion/react"
import { useMemo, useRef, useState } from "react"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"
import { languageName } from "@/lib/language"
import { useScrollEdges } from "@/hooks/useScrollEdges"

const TOOL_REVEAL =
  "opacity-0 group-focus-within/lyrics:opacity-100 group-hover/lyrics:opacity-100 [@media(hover:none)]:group-data-idle/lyrics:opacity-100"

const TOOL_BASE = cn(
  glassClass,
  "relative inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[10px] pr-3 pl-2.5 [corner-shape:superellipse(1.6)] text-xs font-medium text-(--ink-2,var(--color-unison-text-secondary)) transition-[color,background-color,scale,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/[0.08] hover:text-unison-text after:absolute after:inset-x-0 after:-inset-y-0.5 active:not-disabled:scale-[0.96]",
)

const TOOL_CLASS = cn(TOOL_BASE, TOOL_REVEAL)

const SEGMENTS_CLASS = cn(
  glassClass,
  "inline-flex rounded-[10px] p-[3px] transition-opacity duration-150 ease-out [corner-shape:superellipse(1.6)]",
  TOOL_REVEAL,
)

type Mode = "synced" | "raw"

interface LyricsPanelProps {
  variant: VariantFull | undefined
  getCurrentTime: () => number
  getPlaying: () => boolean
  playing?: boolean
  onLineClick: (seconds: number) => void
  lyricsClassName?: string
}

export function LyricsPanel({
  variant,
  getCurrentTime,
  getPlaying,
  playing = false,
  onLineClick,
  lyricsClassName,
}: LyricsPanelProps) {
  const [mode, setMode] = useState<Mode>("synced")
  const [pickedLang, setPickedLang] = useState<string>()
  const languages = useMemo(() => (variant ? translationLanguages(parseVariantLyrics(variant)) : []), [variant])
  const lang = pickTranslationLanguage(languages, pickedLang)
  const [pane, setPane] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(pane)
  const modesRef = useRef<HTMLFieldSetElement>(null)
  const [resumeAutoscroll, setResumeAutoscroll] = useState<(() => void) | null>(null)
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
    <div data-idle={playing ? undefined : ""} className="group/lyrics relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-1.5 group-focus-within/lyrics:pointer-events-auto group-hover/lyrics:pointer-events-auto [@media(hover:none)]:group-data-idle/lyrics:pointer-events-auto">
        <fieldset ref={modesRef} className={SEGMENTS_CLASS}>
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
        <button
          type="button"
          inert={!resumeAutoscroll}
          onClick={() => {
            resumeAutoscroll?.()
            modesRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus()
          }}
          className={cn(
            TOOL_BASE,
            "pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 max-sm:right-0 max-sm:left-auto max-sm:translate-x-0",
            !resumeAutoscroll && "pointer-events-none opacity-0",
          )}
        >
          <IconFocusCentered className="size-4" />
          Resume autoscroll
        </button>
        {variant ? (
          <div className={cn("ml-auto flex items-center gap-1.5", resumeAutoscroll && "max-sm:hidden")}>
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
        data-loading={variant ? undefined : ""}
        className={cn(
          "lyrics-pane [text-shadow:none] [mask-clip:no-clip] [mask-image:linear-gradient(transparent,#000_var(--ft),#000_calc(100%-var(--fb)),transparent)] [mask-repeat:repeat-x]",
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
            onAutoscrollPause={(resume) => setResumeAutoscroll(() => resume)}
            className={lyricsClassName}
          />
        ) : (
          <RawLyricsView body={variant.lyrics} format={variant.format} className={lyricsClassName} />
        )}
      </div>
    </div>
  )
}
