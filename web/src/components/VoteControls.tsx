import NumberFlow from "@number-flow/react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "@/auth/useSession"
import { usePresence } from "@/hooks/usePresence"
import { useVoteMutations } from "@/hooks/useVoteMutations"
import { cn } from "@/lib/cn"
import { chipClass, glassClass, popoverSurfaceClass } from "./ui"
import { REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason } from "@/lib/report-reasons"
import { BlDownvoteIcon, BlReportIcon, BlUpvoteIcon } from "./icons/BlVoteIcons"

interface VoteControlsProps {
  variantId: number
  videoId: string
  variant: { score: number; userVote: 1 | -1 | null }
  beforeReport?: ReactNode
}

const VOTE_BUTTON =
  "relative isolate inline-flex h-[30px] cursor-pointer items-center gap-1.5 before:absolute before:inset-[3px] before:-z-10 before:rounded-[7px] before:[corner-shape:superellipse(1.6)] before:transition-colors before:duration-150 before:ease-[cubic-bezier(0.2,0,0,1)] transition-colors duration-150 enabled:hover:before:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"

interface ReasonOption {
  reason: ReportReason
  label: string
}

const REASONS: ReasonOption[] = REPORT_REASONS.map((reason) => ({ reason, label: REPORT_REASON_LABEL[reason] }))

export function VoteControls({ variantId, videoId, variant, beforeReport }: VoteControlsProps) {
  const session = useSession()
  const mutations = useVoteMutations({ variantId, videoId })
  const disabled = session.status !== "signed-in"
  const disabledTitle = disabled ? "Sign in to vote" : undefined

  const [menuOpen, setMenuOpen] = useState(false)
  const menu = usePresence(menuOpen && !disabled)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (e.target instanceof Node && containerRef.current.contains(e.target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [menuOpen])

  const handleUp = useCallback(() => mutations.upvote(), [mutations])
  const handleDown = useCallback(() => mutations.downvote(), [mutations])
  const handleReport = useCallback(
    (reason: ReportReason) => {
      mutations.report(reason)
      setMenuOpen(false)
    },
    [mutations],
  )

  const upActive = variant.userVote === 1
  const downActive = variant.userVote === -1

  return (
    <>
      <div className={cn(glassClass, "inline-flex h-[30px] select-none items-center rounded-[10px] text-[13px] [corner-shape:superellipse(1.6)] [text-shadow:none]")}>
        <button
          type="button"
          aria-label={`Upvote variant, score ${variant.score}`}
          aria-pressed={upActive}
          disabled={disabled}
          title={disabledTitle}
          onClick={handleUp}
          className={cn(
            VOTE_BUTTON,
            "pr-3 pl-2.5 font-bold tabular-nums",
            upActive ? "text-[#86efac]" : "text-unison-text",
          )}
        >
          <BlUpvoteIcon size={15} />
          <NumberFlow key={variantId} value={variant.score} />
        </button>
        <span aria-hidden="true" className="h-5 w-px bg-white/[0.14]" />
        <button
          type="button"
          aria-label="Downvote variant"
          aria-pressed={downActive}
          disabled={disabled}
          title={disabledTitle}
          onClick={handleDown}
          className={cn(VOTE_BUTTON, "pr-2.5 pl-2", downActive ? "text-[#fcd34d]" : "text-unison-text")}
        >
          <BlDownvoteIcon size={15} />
        </button>
      </div>
      {beforeReport}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-label="Report variant"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled}
          title={disabledTitle}
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(chipClass, "w-[30px] justify-center px-0")}
        >
          <BlReportIcon size={15} />
        </button>
        {menu.mounted ? (
          <div
            role="menu"
            data-origin="top-right"
            className={cn(
              popoverSurfaceClass,
              "t-dropdown absolute top-full right-0 z-10 mt-2 flex min-w-[160px] flex-col rounded-2xl p-1.5 text-[13px]",
              menu.closing && "is-closing",
            )}
          >
            {REASONS.map((r) => (
              <button
                key={r.reason}
                type="button"
                role="menuitem"
                onClick={() => handleReport(r.reason)}
                className="cursor-pointer rounded-[10px] px-3 py-2 text-left font-medium text-unison-text transition-colors duration-150 hover:bg-white/[0.08]"
              >
                {r.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}
