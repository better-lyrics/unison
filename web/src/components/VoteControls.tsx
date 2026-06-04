import { IconChevronDown, IconChevronUp, IconFlag } from "@tabler/icons-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "@/auth/useSession"
import { type ReportReason, useVoteMutations } from "@/hooks/useVoteMutations"
import { cn } from "@/lib/cn"

interface VoteControlsProps {
  variantId: number
  videoId: string
  variant: { voteCount: number; userVote: 1 | -1 | null }
}

interface ReasonOption {
  reason: ReportReason
  label: string
}

const REASONS: ReasonOption[] = [
  { reason: "wrong_song", label: "Wrong song" },
  { reason: "bad_sync", label: "Bad sync" },
  { reason: "offensive", label: "Offensive" },
  { reason: "spam", label: "Spam" },
  { reason: "other", label: "Other" },
]

export function VoteControls({ variantId, videoId, variant }: VoteControlsProps) {
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
    <div ref={containerRef} className="relative inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Upvote variant"
        aria-pressed={upActive}
        disabled={disabled}
        title={disabledTitle}
        onClick={handleUp}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded border border-unison-border text-unison-text-muted transition-colors",
          !disabled && "hover:border-unison-border-strong hover:text-unison-text",
          upActive && "border-green-500/60 bg-green-500/10 text-green-300",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <IconChevronUp size={16} aria-hidden />
      </button>
      <span className="min-w-[2ch] text-center text-xs font-medium tabular-nums text-unison-text">
        {variant.voteCount}
      </span>
      <button
        type="button"
        aria-label="Downvote variant"
        aria-pressed={downActive}
        disabled={disabled}
        title={disabledTitle}
        onClick={handleDown}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded border border-unison-border text-unison-text-muted transition-colors",
          !disabled && "hover:border-unison-border-strong hover:text-unison-text",
          downActive && "border-amber-500/60 bg-amber-500/10 text-amber-300",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <IconChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Report variant"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled}
        title={disabledTitle}
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "ml-1 inline-flex h-7 items-center gap-1 rounded border border-unison-border px-2 text-xs text-unison-text-muted transition-colors",
          !disabled && "hover:border-unison-border-strong hover:text-unison-text",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <IconFlag size={14} aria-hidden />
        <span>Report</span>
      </button>
      {menuOpen && !disabled ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 flex min-w-[140px] flex-col rounded-md border border-unison-border bg-unison-bg-elevated py-1 text-xs shadow-lg"
        >
          {REASONS.map((r) => (
            <button
              key={r.reason}
              type="button"
              role="menuitem"
              onClick={() => handleReport(r.reason)}
              className="px-3 py-1.5 text-left text-unison-text hover:bg-unison-bg-hover"
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
