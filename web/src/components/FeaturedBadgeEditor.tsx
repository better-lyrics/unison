import { useEffect, useRef, useState } from "react"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { editableCardClass } from "@/components/ui"
import { putFeaturedBadges } from "@/lib/api"
import { AUTHED_FETCH_ERRORS } from "@/lib/authedFetch"
import { resolveBadgeImage } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import type { BadgeCatalogue, BadgeDef, UserBadge, UserGamification } from "@/lib/types"

const SAVED_FLASH_MS = 1500

interface FeaturedBadgeEditorProps {
  gamification: UserGamification
  catalogue: BadgeCatalogue
  onSaved: (updated: UserGamification) => void
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }

interface EarnedBadge {
  def: BadgeDef
  badge: UserBadge
}

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i])
}

function errorMessage(raw: string): string {
  if (raw === AUTHED_FETCH_ERRORS.AUTH_REQUIRED) return "Sign in again to update your featured badges."
  if (raw === AUTHED_FETCH_ERRORS.RATE_LIMITED) return "Too many changes. Try again in a moment."
  if (raw && raw !== AUTHED_FETCH_ERRORS.REQUEST_FAILED) return raw
  return "Could not save. Try again."
}

export function FeaturedBadgeEditor({ gamification, catalogue, onSaved }: FeaturedBadgeEditorProps) {
  const featuredMax = catalogue.display.featuredMax
  const defByKey = new Map(catalogue.badges.map((def) => [def.key, def]))
  const earned: EarnedBadge[] = gamification.badges
    .filter((badge) => badge.earned)
    .map((badge) => ({ def: defByKey.get(badge.key), badge }))
    .filter((entry): entry is EarnedBadge => entry.def !== undefined)
  const earnedKeys = new Set(earned.map((entry) => entry.def.key))

  const [selection, setSelection] = useState<string[]>(() => gamification.featured.filter((key) => earnedKeys.has(key)))
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  if (earned.length === 0) return null

  const isDirty = !sameSelection(selection, gamification.featured)
  const saving = status.kind === "saving"

  const toggle = (key: string) => {
    setStatus({ kind: "idle" })
    setSelection((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      if (prev.length >= featuredMax) return prev
      return [...prev, key]
    })
  }

  const reset = () => {
    setStatus({ kind: "idle" })
    setSelection(gamification.featured.filter((key) => earnedKeys.has(key)))
  }

  const save = async () => {
    setStatus({ kind: "saving" })
    try {
      const updated = await putFeaturedBadges(gamification.keyId, selection)
      onSaved(updated)
      setStatus({ kind: "saved" })
      flashTimer.current = window.setTimeout(() => {
        flashTimer.current = null
        setStatus((prev) => (prev.kind === "saved" ? { kind: "idle" } : prev))
      }, SAVED_FLASH_MS)
    } catch (err) {
      setStatus({ kind: "error", message: errorMessage(err instanceof Error ? err.message : String(err)) })
    }
  }

  return (
    <CollapsibleSection
      title="Featured badges"
      testId="featured-badge-editor"
      summary={<span className="text-xs text-unison-text-muted">{gamification.featured.length} featured</span>}
    >
      <div className={editableCardClass}>
        <p className="text-[13px] text-unison-text-muted">Pick up to {featuredMax} badges to show next to your name.</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,84px)]">
          {earned.map(({ def, badge }) => {
            const selected = selection.includes(def.key)
            const disabled = !selected && selection.length >= featuredMax
            return (
              <button
                key={def.key}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggle(def.key)}
                title={disabled ? `You can feature up to ${featuredMax} badges.` : def.name}
                className={cn(
                  "group flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2.5 text-center transition-[background-color,box-shadow,transform] active:scale-[0.96]",
                  selected
                    ? "bg-white/[0.06] shadow-[inset_0_0_0_1px_var(--color-unison-medal-gold)]"
                    : "bg-white/[0.02] hover:bg-unison-bg-hover",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <img
                  src={resolveBadgeImage(def, badge.tier, "color")}
                  alt=""
                  draggable={false}
                  className={cn(
                    "size-10 object-contain transition-opacity",
                    selected ? "opacity-100" : "opacity-70 group-hover:opacity-100",
                  )}
                />
                <span
                  className={cn("text-[11px] leading-tight", selected ? "text-unison-text" : "text-unison-text-muted")}
                >
                  {def.name}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-unison-text-muted">
            {selection.length} of {featuredMax} selected
          </span>
          <div className="flex items-center gap-2">
            {status.kind === "error" ? <span className="text-xs text-unison-warn">{status.message}</span> : null}
            {status.kind === "saved" ? <span className="text-xs text-unison-text-muted">Saved.</span> : null}
            {isDirty && !saving ? (
              <button
                type="button"
                onClick={reset}
                className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-unison-text-muted transition-colors hover:text-unison-text"
              >
                Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={!isDirty || saving}
              className="cursor-pointer rounded-md bg-unison-bg-hover px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}
