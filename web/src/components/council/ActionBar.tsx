import { Kbd } from "@/components/Kbd"
import { NoteField } from "@/components/NoteField"
import { Tooltip } from "@/components/Tooltip"
import { type ButtonVariant, buttonClass, popoverSurfaceClass } from "@/components/ui"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import { usePresence } from "@/hooks/usePresence"
import { cn } from "@/lib/cn"
import type { BookmarkState } from "@/lib/council-triage"
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react"
import { type Icon, IconBookmark, IconBookmarkFilled, IconX } from "@tabler/icons-react"
import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

const COUNCIL_NOTE_MAX = 300

interface ActionBarProps {
  bookmark?: BookmarkState
  onBookmark?: () => void
  bookmarkPending?: boolean
  primary: {
    label: string
    icon: Icon
    shortcut: string
    confirmTitle: string
    confirmBody: ReactNode
    confirmLabel: string
    unavailable: string | null
    unavailableHint?: string
  }
  onPrimary: () => void
  reject: {
    label?: string
    submitLabel: string
    hint: string
    unavailable?: string | null
    noteLabel?: string
    noteMax?: number
    placeholder?: string
    submitVariant?: ButtonVariant
  }
  onReject: (note: string | null) => void
  busy: boolean
  layout?: ActionLayout
}

export type ActionLayout = "bar" | "inline" | "anchored"

type Mode = "idle" | "confirm" | "reject"

export function ActionBar(props: ActionBarProps) {
  const { bookmark, primary, reject, busy } = props
  const [mode, setMode] = useState<Mode>("idle")
  const [note, setNote] = useState("")
  const noteId = useId()
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const askConfirm = () => setMode("confirm")
  const primaryKey = primary.shortcut.toLowerCase()
  const layout = props.layout ?? "bar"
  const shortcuts = layout === "bar"
  const anchored = layout === "anchored"
  const shownMode = useLastOpen(mode, "idle")
  const close = () => {
    if (anchored) (mode === "reject" ? rejectRef : primaryRef).current?.focus()
    setMode("idle")
  }

  const submitReject = () => {
    const trimmed = note.trim()
    props.onReject(trimmed === "" ? null : trimmed)
  }

  useCouncilShortcuts(
    {
      [primaryKey]: () => {
        if (busy || primary.unavailable || mode === "confirm") return
        askConfirm()
      },
      ...(mode === "confirm"
        ? {
            Enter: (event: KeyboardEvent) => {
              if (event.target instanceof Element && event.target.closest("button, a")) return false
              if (!busy) props.onPrimary()
            },
          }
        : {}),
      r: () => {
        if (busy || reject.unavailable) return
        setMode("reject")
        requestAnimationFrame(() => noteRef.current?.focus())
      },
      Escape: () => setMode("idle"),
      ...(mode === "reject" ? { "mod+Enter": submitReject } : {}),
    },
    shortcuts,
  )

  let step: ReactNode = null
  if (shownMode === "reject") {
    step = (
      <form
        className={cn(
          "flex flex-col gap-2.5",
          !anchored && "motion-safe:animate-[bar-in_220ms_cubic-bezier(0.2,0,0,1)_both]",
        )}
        onSubmit={(e) => {
          e.preventDefault()
          submitReject()
        }}
      >
        <NoteField
          id={noteId}
          label={reject.noteLabel ?? "Reason for the council"}
          max={reject.noteMax ?? COUNCIL_NOTE_MAX}
          value={note}
          onChange={setNote}
          inputRef={noteRef}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !anchored) close()
          }}
          placeholder={reject.placeholder ?? "For example: chorus timing lands early on every repeat"}
        />
        {anchored ? <p className="-mt-1 text-pretty text-xs text-unison-text-muted">{reject.hint}</p> : null}
        <div className="flex items-center gap-2">
          {anchored ? null : <span className="text-xs text-unison-text-muted">{reject.hint}</span>}
          <span className="flex-1" />
          <button type="button" className={buttonClass("ghost", "sm")} onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass(reject.submitVariant ?? "danger", "sm")}>
            {reject.submitLabel}
            {shortcuts ? <Kbd keys={["Mod", "Enter"]} /> : null}
          </button>
        </div>
      </form>
    )
  } else if (shownMode === "confirm") {
    step = (
      <ConfirmStep
        title={primary.confirmTitle}
        body={primary.confirmBody}
        label={primary.confirmLabel}
        icon={primary.icon}
        busy={busy}
        shortcut={shortcuts}
        animate={!anchored}
        onConfirm={props.onPrimary}
        onCancel={close}
      />
    )
  }

  let actions: ReactNode = null
  if (anchored || mode === "idle") {
    const PrimaryIcon = primary.icon
    const primaryButton = (
      <button
        ref={primaryRef}
        type="button"
        disabled={busy || primary.unavailable !== null}
        aria-expanded={anchored ? mode === "confirm" : undefined}
        className={buttonClass("primary", "sm")}
        onClick={() => setMode(mode === "confirm" ? "idle" : "confirm")}
      >
        <PrimaryIcon aria-hidden className="size-3.5" stroke={1.75} />
        {primary.unavailable ?? primary.label}
        {primary.unavailable || !shortcuts ? null : <Kbd keys={[primary.shortcut]} className="text-unison-bg/60" />}
      </button>
    )
    const rejectButton = (
      <button
        ref={rejectRef}
        type="button"
        disabled={busy || Boolean(reject.unavailable)}
        aria-expanded={anchored ? mode === "reject" : undefined}
        className={cn(buttonClass("fill", "sm"), "aria-expanded:bg-white/[0.12]")}
        onClick={() => {
          if (mode === "reject") return setMode("idle")
          setMode("reject")
          requestAnimationFrame(() => noteRef.current?.focus())
        }}
      >
        <IconX aria-hidden className="size-3.5" stroke={1.75} />
        {reject.label ?? "Reject"}
        {shortcuts ? <Kbd keys={["R"]} /> : null}
      </button>
    )
    const anchorFor = (owner: Mode) =>
      anchored && shownMode === owner ? (
        <StepAnchor
          open={mode === owner}
          trigger={owner === "reject" ? rejectRef : primaryRef}
          position={rowRef}
          label={stepLabel(owner, primary.confirmTitle, reject.submitLabel)}
          onDismiss={() => setMode("idle")}
          onEscape={close}
          step={step}
        />
      ) : null
    actions = (
      <div ref={rowRef} className="flex items-center gap-2">
        {bookmark && props.onBookmark ? (
          <BookmarkButton state={bookmark} pending={props.bookmarkPending ?? false} onClick={props.onBookmark} />
        ) : null}
        <span className="flex-1" />
        {bookmark?.kind === "other" ? (
          <span className="text-xs text-unison-text-muted">
            You can still decide. {bookmark.holder} will see your decision.
          </span>
        ) : null}
        {reject.unavailable ? (
          <Tooltip label={reject.unavailable}>
            <span data-unavailable-hint className="inline-flex [&>button]:pointer-events-none">
              {rejectButton}
            </span>
          </Tooltip>
        ) : (
          rejectButton
        )}
        {anchorFor("reject")}
        {primary.unavailable && primary.unavailableHint ? (
          <Tooltip label={primary.unavailableHint}>
            <span data-unavailable-hint className="inline-flex [&>button]:pointer-events-none">
              {primaryButton}
            </span>
          </Tooltip>
        ) : (
          primaryButton
        )}
        {anchorFor("confirm")}
      </div>
    )
  }

  if (anchored) return actions
  return (
    <div
      className={
        layout === "inline"
          ? undefined
          : "sticky bottom-0 z-[3] rounded-b-xl bg-[#141318] px-8 py-3.5 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-[#141318] before:to-[rgba(20,19,24,0)] before:content-['']"
      }
    >
      {mode === "idle" ? actions : step}
    </div>
  )
}

const stepLabel = (mode: Mode, confirmTitle: string, rejectLabel: string) =>
  mode === "reject" ? rejectLabel : confirmTitle

function useLastOpen<T>(value: T, closed: T): T {
  const last = useRef(value)
  if (value !== closed) last.current = value
  return last.current
}

export function StepAnchor({
  open,
  trigger,
  position = trigger,
  label,
  step,
  onDismiss,
  onEscape,
}: {
  open: boolean
  trigger: RefObject<HTMLElement | null>
  position?: RefObject<HTMLElement | null>
  label: string
  step: ReactNode
  onDismiss: () => void
  onEscape: () => void
}) {
  const presence = usePresence(open)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next, _event, reason) => {
      if (next) return
      if (reason === "escape-key") onEscape()
      else onDismiss()
    },
    placement: "bottom-end",
    middleware: [offset(8), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  })
  useLayoutEffect(() => {
    if (!presence.mounted) return
    refs.setReference(trigger.current)
    refs.setPositionReference(position.current)
  }, [presence.mounted, refs, trigger, position])
  const dismiss = useDismiss(context, { enabled: open })
  const { getFloatingProps } = useInteractions([dismiss])
  if (!presence.mounted) return null
  return (
    <FloatingPortal>
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={-1}
        returnFocus={false}
        disabled={presence.closing}
      >
        <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-50">
          <dialog
            open
            aria-label={label}
            data-origin="top-right"
            inert={presence.closing}
            className={cn(
              popoverSurfaceClass,
              "t-dropdown static m-0 w-[min(380px,calc(100vw-32px))] rounded-[18px] border-0 p-3",
              presence.closing && "is-closing",
            )}
          >
            {step}
          </dialog>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}

export function ConfirmStep({
  title,
  body,
  label,
  icon: ConfirmIcon,
  busy,
  shortcut = false,
  animate = true,
  onConfirm,
  onCancel,
}: {
  title: string
  body: ReactNode
  label: string
  icon: Icon
  busy: boolean
  shortcut?: boolean
  animate?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => confirmRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5",
        animate && "motion-safe:animate-[bar-in_220ms_cubic-bezier(0.2,0,0,1)_both]",
      )}
    >
      <p className="text-[13px] leading-normal text-unison-text-secondary">
        <b className="font-semibold text-unison-text">{title}</b> {body}
      </p>
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onCancel}>
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          disabled={busy}
          className={buttonClass("primary", "sm")}
          onClick={onConfirm}
        >
          <ConfirmIcon aria-hidden className="size-3.5" stroke={1.75} />
          {label}
          {shortcut ? <Kbd keys={["Enter"]} className="text-unison-bg/60" /> : null}
        </button>
      </div>
    </div>
  )
}

function BookmarkButton({ state, pending, onClick }: { state: BookmarkState; pending: boolean; onClick: () => void }) {
  if (state.kind === "other") {
    return (
      <button type="button" disabled className={buttonClass("ghost", "sm")}>
        <IconBookmark aria-hidden className="size-3.5" stroke={1.75} />
        Bookmarked by {state.holder}
      </button>
    )
  }
  const mine = state.kind === "mine"
  const capped = state.kind === "open" && state.capped
  const Icon = mine ? IconBookmarkFilled : IconBookmark
  return (
    <button type="button" disabled={pending || capped} onClick={onClick} className={buttonClass("ghost", "sm")}>
      <Icon aria-hidden className="size-3.5" stroke={1.75} />
      {mine ? "Release" : capped ? `${state.cap} of ${state.cap} bookmarks used` : "Bookmark"}
      {capped ? null : <Kbd keys={["B"]} />}
    </button>
  )
}
