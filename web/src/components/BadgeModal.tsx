import { IconX } from "@tabler/icons-react"
import { type ReactNode, useEffect, useRef } from "react"
import { resolveBadgeImage } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import type { BadgeDef, UserBadge } from "@/lib/types"

export interface BadgeModalSelection {
  def: BadgeDef
  userBadge: UserBadge | undefined
  rare: boolean
  isCurrentTier: boolean
  tierRank: number | null
}

interface BadgeModalProps {
  selection: BadgeModalSelection
  closing: boolean
  onRequestClose: () => void
  onExited: () => void
}

const EXIT_FALLBACK_MS = 240

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatEarnedAt(earnedAt: number | undefined): string | null {
  if (earnedAt === undefined) return null
  const date = new Date(earnedAt * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
}

function stateChipText(sel: BadgeModalSelection): string {
  const { userBadge, isCurrentTier, tierRank } = sel
  if (userBadge?.earned) {
    const parts = ["Earned"]
    if (userBadge.tier !== undefined && sel.def.tiers) parts.push(`Tier ${userBadge.tier}`)
    if (isCurrentTier && tierRank != null) parts.push(`Rank #${tierRank}`)
    const earnedAt = formatEarnedAt(userBadge.earnedAt)
    if (earnedAt) parts.push(earnedAt)
    return parts.join(" · ")
  }
  const progress = userBadge?.progress
  if (progress?.next != null) return `Locked · ${progress.current} of ${progress.next}`
  return "Locked"
}

// The metric line only appears when it adds information beyond the state chip
// (tier progress, a rank, or an earned date). Otherwise it is omitted.
function metricNode(sel: BadgeModalSelection): ReactNode {
  const { def, userBadge } = sel
  const earned = userBadge?.earned ?? false
  if (def.tiers && def.tiers.length > 0) {
    if (earned) {
      const current = userBadge?.tier ?? def.tiers.length
      return (
        <>
          Tier <b className="font-bold text-unison-medal-gold">{current}</b> of {def.tiers.length} unlocked
        </>
      )
    }
    const progress = userBadge?.progress
    if (progress?.next != null) {
      const remaining = Math.max(0, progress.next - progress.current)
      const firstTier = def.tiers[0]?.name ?? "Tier 1"
      return (
        <>
          <b className="font-bold text-unison-medal-gold">{remaining}</b> more to unlock {firstTier}
        </>
      )
    }
    return null
  }
  if (earned) {
    const rank = sel.isCurrentTier && sel.tierRank != null ? `Rank #${sel.tierRank}` : null
    const earnedAt = formatEarnedAt(userBadge?.earnedAt)
    if (rank || earnedAt) {
      return (
        <>
          {rank ? <b className="font-bold text-unison-medal-gold">{rank}</b> : null}
          {rank && earnedAt ? " · " : null}
          {earnedAt ? `Earned ${earnedAt}` : null}
        </>
      )
    }
  }
  return null
}

function TierLadder({ def, current }: { def: BadgeDef; current: number }) {
  if (!def.tiers || def.tiers.length === 0) return null
  return (
    <div className="mb-4 flex gap-2">
      {def.tiers.map((tier, i) => {
        const on = i < current
        return (
          <div key={tier.level} className="flex-1 text-center">
            <div
              className={cn(
                "h-[5px] rounded-full",
                on ? "bg-gradient-to-r from-[#ffb020] to-unison-medal-gold" : "bg-white/10",
              )}
            />
            <div className={cn("mt-1.5 text-[10.5px]", on ? "text-unison-text-secondary" : "text-white/30")}>
              {tier.name ?? `Tier ${tier.level}`} · {tier.threshold}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Chip({ tone, children }: { tone: "on" | "off" | "rare" | "cat"; children: ReactNode }) {
  const toneClass = {
    on: "bg-[rgba(255,200,61,0.14)] text-unison-medal-gold",
    off: "bg-unison-surface text-unison-text-muted",
    rare: "bg-[rgba(245,166,35,0.14)] text-unison-warn",
    cat: "bg-unison-surface text-unison-text-secondary",
  }[tone]
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-semibold", toneClass)}>
      {children}
    </span>
  )
}

export function BadgeModal({ selection, closing, onRequestClose, onExited }: BadgeModalProps) {
  const { def, userBadge, rare } = selection
  const earned = userBadge?.earned ?? false
  const tier = userBadge?.tier
  const src = resolveBadgeImage(def, tier, earned ? "color" : "mono")
  const currentTier = earned ? (tier ?? def.tiers?.length ?? 0) : 0
  const metric = metricNode(selection)

  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onRequestClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onRequestClose])

  useEffect(() => {
    if (!closing) return
    const card = cardRef.current
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onExited()
    }
    card?.addEventListener("animationend", finish, { once: true })
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS)
    return () => {
      window.clearTimeout(timer)
      card?.removeEventListener("animationend", finish)
    }
  }, [closing, onExited])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop close is a convenience; Escape and the close button provide keyboard access
    <div
      data-testid="badge-modal-overlay"
      className={cn(
        "bm-overlay fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,10,12,0.62)] p-6 backdrop-blur-[6px]",
        closing && "bm-closing",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onRequestClose()
      }}
    >
      <div
        ref={cardRef}
        // biome-ignore lint/a11y/useSemanticElements: animated custom modal; a native <dialog> cannot drive the enter/exit keyframes
        role="dialog"
        aria-modal="true"
        aria-label={def.name}
        className={cn(
          "bm-card relative w-[380px] max-w-full overflow-hidden rounded-[20px] bg-[#1f2023] shadow-[inset_0_0_0_1px_var(--color-unison-border-strong),0_24px_60px_rgba(0,0,0,0.5)]",
          closing && "bm-closing",
        )}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onRequestClose}
          className="absolute top-3.5 right-3.5 z-[3] grid size-[30px] cursor-pointer place-items-center rounded-[9px] bg-unison-surface text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
        >
          <IconX className="size-[15px]" stroke={2} />
        </button>

        <div className="relative px-6 pt-10 pb-3 text-center">
          <div className="relative mx-auto mb-4 grid size-[120px] place-items-center">
            <img
              src={src}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={cn(
                "absolute top-1/2 left-1/2 size-[92px] -translate-x-1/2 -translate-y-1/2 scale-125 blur-[24px]",
                earned ? "opacity-50" : "opacity-[0.28]",
              )}
            />
            <img
              src={src}
              alt={def.name}
              draggable={false}
              className={cn("relative size-[104px] select-none", earned ? "" : "opacity-[0.42]")}
            />
          </div>
          <h2 className="mb-2.5 text-[22px] font-bold tracking-[-0.01em] text-unison-text">{def.name}</h2>
          <div className="flex flex-wrap justify-center gap-2">
            <Chip tone={earned ? "on" : "off"}>{stateChipText(selection)}</Chip>
            {rare ? <Chip tone="rare">Rare</Chip> : null}
            <Chip tone="cat">{titleCase(def.category)}</Chip>
          </div>
        </div>

        <div className="px-6 pt-3 pb-6">
          <p className="mb-4 text-center text-sm leading-normal text-unison-text-secondary">{def.description}</p>
          <TierLadder def={def} current={currentTier} />
          {metric !== null ? (
            <div data-testid="badge-modal-metric" className="text-center text-[12.5px] text-unison-text-muted">
              {metric}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
