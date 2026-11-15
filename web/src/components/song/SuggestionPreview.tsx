import { timingNote } from "@/components/DiffView"
import { Tooltip } from "@/components/Tooltip"
import { Segmented } from "@/components/council/Segmented"
import {
  NOT_LOADED_HINT,
  SuggestionAuthor,
  SuggestionChangesDialog,
  SuggestionDecision,
  SuggestionNote,
  authorName,
} from "@/components/song/SuggestionChanges"
import { Bone } from "@/components/skeleton"
import { buttonClass, chipClass, chipIconClass, glassClass, scrollFadeClass } from "@/components/ui"
import { usePresence } from "@/hooks/usePresence"
import { cn } from "@/lib/cn"
import { formatDuration, formatElapsed, formatRemaining } from "@/lib/format"
import {
  JUMP_LEAD_IN_MS,
  type JumpChange,
  type JumpTarget,
  type PreviewActions,
  type SuggestionContent,
} from "@/lib/lyric-suggestion"
import type { SuggestionInboxItem } from "@/lib/revision-types"
import type { RevisionSuggestion } from "@/lib/types"
import { IconArrowsDiff, IconChevronDown, IconEye, IconListSearch, IconPlayerPlay } from "@tabler/icons-react"
import { useId, useRef, useState } from "react"

export type PreviewView = "live" | "suggestion"

const RAIL_CARD = cn(glassClass, "rounded-[22px] p-[18px]")
const RAIL_LABEL = "mb-3 text-xs font-medium text-(--ink-3)"
const ACC_CHEVRON =
  "opacity-50 transition-transform duration-(--acc-expand) ease-(--acc-ease) motion-reduce:transition-none [&_path]:[vector-effect:non-scaling-stroke]"

export function SuggestionPreviewBar({
  item,
  liveRevNo,
  actionsFor,
  content,
  ownerless,
  view,
  onView,
  onDone,
  now,
}: {
  item: SuggestionInboxItem
  liveRevNo: number
  actionsFor: (content: SuggestionContent) => PreviewActions
  content: SuggestionContent
  ownerless?: boolean
  view: PreviewView
  onView: (view: PreviewView) => void
  onDone: () => void
  now: number
}) {
  const [changesOpen, setChangesOpen] = useState(false)
  const loadFailed = content === "failed"
  const changes = usePresence(changesOpen && !loadFailed, "--modal-close-dur")
  const { suggestion } = item
  const seeChanges = (
    <button
      type="button"
      disabled={loadFailed}
      className={buttonClass("ghost", "sm")}
      onClick={() => setChangesOpen(true)}
    >
      <IconArrowsDiff aria-hidden className="size-3.5" stroke={1.75} />
      See changes
    </button>
  )
  return (
    <section
      aria-label="Suggestion preview"
      className={cn(
        glassClass,
        "flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl py-2 pr-2 pl-3 text-[13px] [text-shadow:none]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-unison-text-secondary">
        <IconEye aria-hidden className="size-[15px] shrink-0 text-unison-text opacity-50" stroke={1.75} />
        {view === "suggestion" ? (
          <>
            <SuggestionAuthor suggestion={suggestion} className="size-[22px]" />
            <span className="min-w-0">
              Showing{" "}
              <b className="font-semibold text-unison-text">{`${authorName(suggestion, "mid")}'s suggestion`}</b>
              <span className="text-unison-text-muted tabular-nums">
                {` · Rev ${suggestion.revNo} · ${formatElapsed(now - suggestion.createdAt)} ago`}
              </span>
            </span>
          </>
        ) : (
          <span className="min-w-0">
            Showing <b className="font-semibold text-unison-text">the live version</b>
            <span className="text-unison-text-muted tabular-nums">{` · Rev ${liveRevNo}`}</span>
          </span>
        )}
      </div>
      <Segmented
        label="Version to show"
        size="md"
        value={view}
        onChange={onView}
        options={[
          { value: "live", label: "Live" },
          { value: "suggestion", label: "Suggestion", disabled: loadFailed },
        ]}
      />
      <div className="ml-auto flex items-center gap-1.5">
        {loadFailed ? (
          <Tooltip label={NOT_LOADED_HINT}>
            <span data-unavailable-hint className="inline-flex [&>button]:pointer-events-none">
              {seeChanges}
            </span>
          </Tooltip>
        ) : (
          seeChanges
        )}
        <SuggestionDecision
          item={item}
          actions={actionsFor(content)}
          ownerless={ownerless}
          layout="anchored"
          onDone={onDone}
        />
      </div>
      {changes.mounted ? (
        <SuggestionChangesDialog
          open={changesOpen && !loadFailed}
          item={item}
          actionsFor={actionsFor}
          now={now}
          ownerless={ownerless}
          onClose={() => setChangesOpen(false)}
          onDone={onDone}
        />
      ) : null}
    </section>
  )
}

const CHANGE_LABEL: Record<Exclude<JumpChange, "timing">, string> = {
  text: "Text changed",
  added: "Line added",
  removed: "Line removed",
  syllables: "Syllable timing changed",
}

const jumpLabel = (jump: JumpTarget) =>
  jump.change === "timing" ? `Moved ${timingNote(jump.deltaMs ?? 0)}` : CHANGE_LABEL[jump.change]

const stamp = (ms: number) => formatDuration(ms / 1000) || "0:00"

interface SuggestionRailProps {
  suggestion: RevisionSuggestion
  jumps: JumpTarget[] | undefined
  onJump: (jump: JumpTarget) => void
  unsynced?: boolean
  className?: string
}

export function SuggestionRailFold({ className, ...rail }: SuggestionRailProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className={cn("t-acc mt-2.5", className)} data-open={open}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className={cn(chipClass, "aria-expanded:bg-white/[0.14] aria-expanded:text-unison-text")}
      >
        <IconListSearch aria-hidden className={chipIconClass} stroke={1.75} />
        Where to look
        <IconChevronDown
          aria-hidden
          className={cn(chipIconClass, "-mr-0.5", ACC_CHEVRON, open && "-scale-y-100")}
          stroke={1.75}
        />
      </button>
      <div id={panelId} inert={!open} className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className="pt-2.5">
            <SuggestionRail {...rail} />
          </div>
        </div>
      </div>
    </div>
  )
}

const JUMPS_SHOWN = 5

export function SuggestionRail({ suggestion, jumps, onJump, unsynced = false, className }: SuggestionRailProps) {
  const [jumped, setJumped] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const moreId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const hidden = jumps ? jumps.length - JUMPS_SHOWN : 0
  const toggleMore = () => {
    const next = !expanded
    setExpanded(next)
    const area = scrollRef.current
    if (!area) return
    if (!next) area.scrollTo({ top: 0 })
    else requestAnimationFrame(() => area.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" }))
  }
  const row = (jump: JumpTarget) => {
    const key = `${jump.change}-${jump.lineNo}-${jump.startMs}`
    return (
      <li key={key}>
        <button
          type="button"
          aria-current={jumped === key ? "true" : undefined}
          onClick={() => {
            setJumped(key)
            onJump(jump)
          }}
          className="grid min-h-10 w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[13px] text-(--ink-2) transition-[background-color,color,scale] duration-150 ease-out hover:bg-unison-bg-hover hover:text-unison-text active:scale-[0.96] aria-[current]:bg-unison-bg-hover aria-[current]:text-unison-text"
        >
          <span className="font-mono text-xs font-medium text-unison-text tabular-nums">{stamp(jump.startMs)}</span>
          <span className="min-w-0">
            {jumpLabel(jump)}
            <small className="block truncate text-[11.5px] text-(--ink-3)">{jump.text}</small>
          </span>
          <IconPlayerPlay aria-hidden className="size-[15px] text-unison-text opacity-50" stroke={1.75} />
        </button>
      </li>
    )
  }
  return (
    <div className={cn(RAIL_CARD, "t-reveal", className)}>
      {suggestion.note ? (
        <>
          <p className={RAIL_LABEL}>{`Note from ${authorName(suggestion, "mid")}`}</p>
          <div className="mb-4">
            <SuggestionNote note={suggestion.note} />
          </div>
        </>
      ) : null}
      <p className={cn(RAIL_LABEL, "mb-1.5")}>Where to look</p>
      {jumps === undefined ? (
        <Bone className="h-[124px] w-full rounded-[10px]" />
      ) : jumps.length === 0 ? (
        <p className="text-[13px] text-(--ink-3)">
          {unsynced
            ? "No lines to jump to. Open See changes for the details."
            : "No timed lines changed. Open See changes for the details."}
        </p>
      ) : (
        <>
          <div
            ref={scrollRef}
            className={cn(
              hidden > 0 && "-mx-1 max-h-[min(440px,55dvh)] overflow-y-auto overscroll-contain px-1",
              expanded && cn(scrollFadeClass, "pb-7"),
            )}
          >
            <ul aria-label="Jump to a change" className="flex flex-col gap-0.5">
              {jumps.slice(0, JUMPS_SHOWN).map(row)}
              {hidden > 0 ? (
                <li className="t-acc" data-open={expanded}>
                  <div id={moreId} inert={!expanded} className="t-acc-panel">
                    <div className="t-acc-panel-inner">
                      <ul className="flex flex-col gap-0.5">{jumps.slice(JUMPS_SHOWN).map(row)}</ul>
                    </div>
                  </div>
                </li>
              ) : null}
            </ul>
          </div>
          {hidden > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={toggleMore}
              className={cn(buttonClass("ghost", "sm"), "mt-1 min-h-10 w-full justify-start px-2 tabular-nums")}
            >
              <IconChevronDown
                aria-hidden
                className={cn("size-3.5", ACC_CHEVRON, expanded && "-scale-y-100")}
                stroke={1.75}
              />
              {expanded ? "Show fewer" : `Show ${hidden} more`}
            </button>
          ) : null}
          <p className="mt-2.5 text-[11.5px] text-(--ink-3)">
            {`Each one starts playing ${JUMP_LEAD_IN_MS / 1000} seconds before its line.`}
          </p>
        </>
      )}
    </div>
  )
}

export function SuggestionNotice({
  suggestion,
  actions,
  now,
  onPreview,
}: {
  suggestion: RevisionSuggestion
  actions: PreviewActions
  now: number
  onPreview: () => void
}) {
  const when = `${formatElapsed(now - suggestion.createdAt)} ago`
  const who =
    actions.approve === "council-decides"
      ? "The council decides. You can reject it."
      : suggestion.councilDecidesAt === null
        ? "The council can decide too"
        : `${formatRemaining(suggestion.councilDecidesAt - now)} left to decide`
  return (
    <div className={cn(RAIL_CARD, "t-reveal flex items-center gap-3")}>
      <SuggestionAuthor suggestion={suggestion} className="size-7" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{`${authorName(suggestion, "start")} suggested an edit`}</p>
        <p className="text-xs text-(--ink-3) tabular-nums">{`${when} · ${who}`}</p>
      </div>
      <button type="button" className={cn(buttonClass("fill", "sm"), "ml-auto")} onClick={onPreview}>
        <IconEye aria-hidden className="size-3.5" stroke={1.75} />
        Preview
      </button>
    </div>
  )
}
