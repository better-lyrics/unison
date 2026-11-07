import { CopyButton } from "@/components/CopyButton"
import { DownloadButton } from "@/components/DownloadButton"
import { LyricsContentSkeleton, LyricsRenderer, parseVariantLyrics } from "@/components/LyricsRenderer"
import { RawLyricsView } from "@/components/RawLyricsView"
import { Bone } from "@/components/skeleton"
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

const TOOL_CLASS = cn(
  glassClass,
  "relative inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[10px] pr-3 pl-2.5 [corner-shape:superellipse(1.6)] text-xs font-medium text-(--ink-2,var(--color-unison-text-secondary)) transition-[color,background-color,scale,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/[0.08] hover:text-unison-text after:absolute after:inset-x-0 after:-inset-y-0.5 active:not-disabled:scale-[0.96]",
)

const SEGMENTS_CLASS = cn(glassClass, "inline-flex rounded-[10px] p-[3px] [corner-shape:superellipse(1.6)]")

const TOOLS_ROW = "flex flex-wrap items-center gap-1.5 p-px pb-3"

export function LyricsToolsSkeleton() {
  return (
    <div className={TOOLS_ROW}>
      <Bone className="h-[30px] w-[117px] rounded-[10px]" />
      <div className="ml-auto flex items-center gap-1.5">
        <Bone className="h-[30px] w-[74px] rounded-[10px]" />
        <Bone className="h-[30px] w-[100px] rounded-[10px]" />
      </div>
    </div>
  )
}

type Mode = "synced" | "raw"

interface LyricsPanelProps {
  variant: VariantFull | undefined
  getCurrentTime: () => number
  getPlaying: () => boolean
  playing?: boolean
  toolsOpen?: boolean
  onLineClick: (seconds: number) => void
  lyricsClassName?: string
}

export function LyricsPanel({
  variant,
  getCurrentTime,
  getPlaying,
  playing = false,
  toolsOpen = !playing,
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
    <div className="t-acc" data-open={toolsOpen}>
      <div inert={!toolsOpen} className="t-acc-panel">
        <div className="t-acc-panel-inner">
          {variant ? (
            <div className={TOOLS_ROW}>
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
              <div className="ml-auto flex items-center gap-1.5">
                <CopyButton text={variant.lyrics} className={TOOL_CLASS} iconClassName="size-4" radius={10} withText />
                <DownloadButton
                  onClick={() =>
                    downloadTextFile(lyricsFilename(variant), variant.lyrics, MIME_BY_FORMAT[variant.format])
                  }
                  className={TOOL_CLASS}
                  iconClassName="size-4"
                  withText
                />
              </div>
            </div>
          ) : (
            <LyricsToolsSkeleton />
          )}
        </div>
      </div>
      <div className="relative">
        <button
          type="button"
          inert={!resumeAutoscroll}
          onClick={() => {
            resumeAutoscroll?.()
            modesRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus()
          }}
          className={cn(
            TOOL_CLASS,
            "absolute top-0 left-1/2 z-10 -translate-x-1/2",
            !resumeAutoscroll && "pointer-events-none opacity-0",
          )}
        >
          <IconFocusCentered className="size-4" />
          Resume autoscroll
        </button>
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
    </div>
  )
}
