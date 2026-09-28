import { Kbd } from "@/components/Kbd"
import { buttonClass } from "@/components/ui"
import { useCouncilShortcuts } from "@/hooks/useCouncilShortcuts"
import type { BookmarkState } from "@/lib/council-triage"
import { type Icon, IconBookmark, IconBookmarkFilled, IconX } from "@tabler/icons-react"
import { type ReactNode, useId, useRef, useState } from "react"

const NOTE_MAX = 300

interface ActionBarProps {
  bookmark: BookmarkState
  onBookmark: () => void
  bookmarkPending: boolean
  primary: {
    label: string
    icon: Icon
    shortcut: string
    confirmTitle: string
    confirmBody: ReactNode
    confirmLabel: string
    unavailable: string | null
  }
  onPrimary: () => void
  reject: { submitLabel: string; hint: string }
  onReject: (note: string | null) => void
  busy: boolean
}

type Mode = "idle" | "confirm" | "reject"

export function ActionBar(props: ActionBarProps) {
  const { bookmark, primary, reject, busy } = props
  const [mode, setMode] = useState<Mode>("idle")
  const [note, setNote] = useState("")
  const noteId = useId()
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const primaryKey = primary.shortcut.toLowerCase()

  const submitReject = () => {
    const trimmed = note.trim()
    props.onReject(trimmed === "" ? null : trimmed)
  }

  useCouncilShortcuts({
    [primaryKey]: () => {
      if (busy || primary.unavailable) return
      if (mode === "confirm") props.onPrimary()
      else setMode("confirm")
    },
    r: () => {
      if (busy) return
      setMode("reject")
      requestAnimationFrame(() => noteRef.current?.focus())
    },
    Escape: () => setMode("idle"),
    ...(mode === "reject" ? { "mod+Enter": submitReject } : {}),
  })

  let body: ReactNode
  if (mode === "reject") {
    body = (
      <form
        className="flex motion-safe:animate-[bar-in_220ms_cubic-bezier(0.2,0,0,1)_both] flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          submitReject()
        }}
      >
        <label
          htmlFor={noteId}
          className="flex justify-between text-[10px] uppercase tracking-[0.08em] text-unison-text-muted"
        >
          Reason for the council
          <span className="font-mono">
            {note.length}/{NOTE_MAX}
          </span>
        </label>
        <textarea
          id={noteId}
          ref={noteRef}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMode("idle")
          }}
          placeholder="For example: chorus timing lands early on every repeat"
          className="min-h-16 w-full resize-y rounded-md border border-unison-border bg-unison-bg px-2.5 py-2 text-[13px] leading-normal outline-none transition-colors focus:border-unison-border-strong"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-unison-text-muted">{reject.hint}</span>
          <span className="flex-1" />
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setMode("idle")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass("danger", "sm")}>
            {reject.submitLabel}
            <Kbd keys={["Mod", "Enter"]} />
          </button>
        </div>
      </form>
    )
  } else if (mode === "confirm") {
    const PrimaryIcon = primary.icon
    body = (
      <div className="flex motion-safe:animate-[bar-in_220ms_cubic-bezier(0.2,0,0,1)_both] flex-col gap-2.5">
        <p className="text-[13px] leading-normal text-unison-text-secondary">
          <b className="font-semibold text-unison-text">{primary.confirmTitle}</b> {primary.confirmBody}
        </p>
        <div className="flex items-center gap-2">
          <span className="flex-1" />
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setMode("idle")}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={props.onPrimary}>
            <PrimaryIcon aria-hidden className="size-3.5" stroke={1.75} />
            {primary.confirmLabel}
            <Kbd keys={[primary.shortcut]} className="text-unison-bg/60" />
          </button>
        </div>
      </div>
    )
  } else {
    const PrimaryIcon = primary.icon
    body = (
      <div className="flex items-center gap-2">
        <BookmarkButton state={bookmark} pending={props.bookmarkPending} onClick={props.onBookmark} />
        <span className="flex-1" />
        {bookmark.kind === "other" ? (
          <span className="text-xs text-unison-text-muted">
            You can still decide. {bookmark.holder} will see your decision.
          </span>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className={buttonClass("fill", "sm")}
          onClick={() => {
            setMode("reject")
            requestAnimationFrame(() => noteRef.current?.focus())
          }}
        >
          <IconX aria-hidden className="size-3.5" stroke={1.75} />
          Reject
          <Kbd keys={["R"]} />
        </button>
        <button
          type="button"
          disabled={busy || primary.unavailable !== null}
          className={buttonClass("primary", "sm")}
          onClick={() => setMode("confirm")}
        >
          <PrimaryIcon aria-hidden className="size-3.5" stroke={1.75} />
          {primary.unavailable ?? primary.label}
          {primary.unavailable ? null : <Kbd keys={[primary.shortcut]} className="text-unison-bg/60" />}
        </button>
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 z-[3] rounded-b-xl bg-[#141318] px-8 py-3.5 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-[#141318] before:to-[rgba(20,19,24,0)] before:content-['']">
      {body}
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
