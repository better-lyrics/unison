import { IconX } from "@tabler/icons-react"
import { AnimatePresence, MotionConfig, Reorder } from "motion/react"
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

function moveKey(list: string[], key: string, delta: number): string[] {
  const from = list.indexOf(key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

function errorMessage(raw: string): string {
  if (raw === AUTHED_FETCH_ERRORS.AUTH_REQUIRED) return "Sign in again to update your featured badges."
  if (raw === AUTHED_FETCH_ERRORS.RATE_LIMITED) return "Too many changes. Try again in a moment."
  if (raw && raw !== AUTHED_FETCH_ERRORS.REQUEST_FAILED) return raw
  return "Could not save. Try again."
}

interface FeaturedTileProps {
  entry: EarnedBadge
  onUnfeature: (key: string) => void
  onMove: (key: string, delta: number) => void
}

function FeaturedTile({ entry, onUnfeature, onMove }: FeaturedTileProps) {
  const { def, badge } = entry
  return (
    <Reorder.Item
      value={def.key}
      aria-label={def.name}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          onMove(def.key, -1)
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          onMove(def.key, 1)
        }
      }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="group relative shrink-0 cursor-grab touch-none rounded-xl bg-unison-bg-elevated p-1 outline-none focus-visible:ring-2 focus-visible:ring-unison-medal-gold active:cursor-grabbing"
    >
      <img
        src={resolveBadgeImage(def, badge.tier, "color")}
        alt=""
        draggable={false}
        className="size-12 select-none object-contain"
      />
      <button
        type="button"
        aria-label={`Unfeature ${def.name}`}
        title="Remove from featured"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onUnfeature(def.key)}
        className="absolute top-0 right-0 grid size-5 cursor-pointer place-items-center rounded-full bg-unison-bg-elevated text-white/80 opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-opacity hover:text-white group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <IconX className="size-3" stroke={2.5} />
      </button>
    </Reorder.Item>
  )
}

export function FeaturedBadgeEditor({ gamification, catalogue, onSaved }: FeaturedBadgeEditorProps) {
  const featuredMax = catalogue.display.featuredMax
  const defByKey = new Map(catalogue.badges.map((def) => [def.key, def]))
  const earned: EarnedBadge[] = gamification.badges
    .filter((badge) => badge.earned)
    .map((badge) => ({ def: defByKey.get(badge.key), badge }))
    .filter((entry): entry is EarnedBadge => entry.def !== undefined)
  const earnedKeys = new Set(earned.map((entry) => entry.def.key))
  const earnedByKey = new Map(earned.map((entry) => [entry.def.key, entry]))

  const [selection, setSelection] = useState<string[]>(() =>
    gamification.featured.filter((key) => earnedKeys.has(key)),
  )
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const flashTimer = useRef<number | null>(null)

  const addableKeys = earned.map((entry) => entry.def.key).filter((key) => !selection.includes(key))

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  if (earned.length === 0) return null

  const isDirty = !sameSelection(selection, gamification.featured)
  const saving = status.kind === "saving"
  const atCap = selection.length >= featuredMax

  const feature = (key: string) => {
    setStatus({ kind: "idle" })
    if (atCap) return
    setSelection((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }

  const unfeature = (key: string) => {
    setStatus({ kind: "idle" })
    setSelection((prev) => prev.filter((k) => k !== key))
  }

  const move = (key: string, delta: number) => {
    setStatus({ kind: "idle" })
    setSelection((prev) => moveKey(prev, key, delta))
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
      summary={<span className="text-xs text-unison-text-muted">{selection.length} featured</span>}
    >
      <MotionConfig reducedMotion="user">
        <div className={editableCardClass}>
          {selection.length > 0 ? (
            <Reorder.Group
              as="ul"
              axis="x"
              values={selection}
              onReorder={(next) => {
                setStatus({ kind: "idle" })
                setSelection(next)
              }}
              className="flex list-none gap-2 overflow-x-auto pt-1 pb-0.5"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {selection.map((key) => {
                  const entry = earnedByKey.get(key)
                  if (!entry) return null
                  return <FeaturedTile key={key} entry={entry} onUnfeature={unfeature} onMove={move} />
                })}
              </AnimatePresence>
            </Reorder.Group>
          ) : (
            <p className="text-[13px] text-unison-text-muted">
              Add up to {featuredMax} badges to show next to your name.
            </p>
          )}

          {addableKeys.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {addableKeys.map((key) => {
                const entry = earnedByKey.get(key)
                if (!entry) return null
                const { def, badge } = entry
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={atCap}
                    onClick={() => feature(key)}
                    title={atCap ? `You can feature up to ${featuredMax} badges.` : `Feature ${def.name}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-3 pl-1.5 transition-colors hover:bg-unison-bg-hover",
                      atCap && "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )}
                  >
                    <img
                      src={resolveBadgeImage(def, badge.tier, "color")}
                      alt=""
                      draggable={false}
                      className="size-7 object-contain"
                    />
                    <span className="text-xs text-unison-text-secondary">{def.name}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

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
      </MotionConfig>
    </CollapsibleSection>
  )
}
