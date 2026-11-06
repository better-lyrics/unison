import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "@/auth/useSession"
import { useVoteMutations } from "@/hooks/useVoteMutations"
import { cn } from "@/lib/cn"
import { glassActionClass, glassClass } from "./ui"
import { REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason } from "@/lib/report-reasons"
import { BlDownvoteIcon, BlReportIcon, BlUpvoteIcon } from "./icons/BlVoteIcons"

interface VoteControlsProps {
  variantId: number
  videoId: string
  variant: { score: number; userVote: 1 | -1 | null }
  beforeReport?: ReactNode
}

const VOTE_BUTTON =
  "relative isolate inline-flex h-11 cursor-pointer items-center gap-2 before:absolute before:inset-1 before:-z-10 before:rounded-full before:transition-colors before:duration-150 before:ease-[cubic-bezier(0.2,0,0,1)] enabled:hover:before:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"

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
      <div className={cn(glassClass, "inline-flex h-11 items-center rounded-full")}>
        <button
          type="button"
          aria-label="Upvote variant"
          aria-pressed={upActive}
          disabled={disabled}
          title={disabledTitle}
          onClick={handleUp}
          className={cn(
            VOTE_BUTTON,
            "rounded-l-full pr-4 pl-3.5 font-bold tabular-nums",
            upActive ? "text-[#86efac]" : "text-unison-text",
          )}
        >
          <BlUpvoteIcon size={18} />
          {variant.score}
        </button>
        <span aria-hidden="true" className="h-5 w-px bg-white/[0.14]" />
        <button
          type="button"
          aria-label="Downvote variant"
          aria-pressed={downActive}
          disabled={disabled}
          title={disabledTitle}
          onClick={handleDown}
          className={cn(VOTE_BUTTON, "rounded-r-full pr-4 pl-3", downActive ? "text-[#fcd34d]" : "text-unison-text")}
        >
          <BlDownvoteIcon size={18} />
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
          className={cn(glassActionClass, "w-11 px-0")}
        >
          <BlReportIcon size={18} />
        </button>
        {menuOpen && !disabled ? (
          <div
            role="menu"
            className="absolute top-full right-0 z-10 mt-2 flex min-w-[160px] flex-col rounded-2xl bg-[rgba(20,19,24,0.92)] p-1.5 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06),0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-[20px]"
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
