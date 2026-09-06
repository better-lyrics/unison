import { Fragment, type ReactNode } from "react"
import { useBadgeModal } from "@/components/BadgeModalContext"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { OdometerNumber } from "@/components/OdometerNumber"
import { groupBadgesByCategory, isRareBadge, resolveBadgeImage } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import type { BadgeCatalogue, BadgeDef, UserBadge, UserGamification } from "@/lib/types"

interface BadgeWallProps {
  gamification: UserGamification
  catalogue: BadgeCatalogue
  defaultOpen?: boolean
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function stateText(userBadge: UserBadge | undefined): string {
  if (userBadge?.earned) {
    return userBadge.tier !== undefined ? `Earned, tier ${userBadge.tier}` : "Earned"
  }
  const progress = userBadge?.progress
  if (progress?.next != null) return `Locked · ${progress.current} of ${progress.next}`
  return "Locked"
}

function Pips({ current, next }: { current: number; next: number }) {
  const dots = Array.from({ length: next }, (_, i) => i < current)
  return (
    <div className="mt-1.5 flex justify-center gap-[3px]">
      {dots.map((on, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length progress pips have no id
          key={i}
          className={cn("h-[3px] w-3 rounded-full", on ? "bg-unison-medal-gold" : "bg-white/10")}
        />
      ))}
    </div>
  )
}

function BadgeMeta({
  def,
  userBadge,
  rare,
  isCurrentTier,
  tierRank,
}: {
  def: BadgeDef
  userBadge: UserBadge | undefined
  rare: boolean
  isCurrentTier: boolean
  tierRank: number | null
}) {
  const earned = userBadge?.earned ?? false
  const tier = userBadge?.tier
  const progress = userBadge?.progress
  const parts: { key: string; node: ReactNode }[] = []

  if (isCurrentTier && tierRank != null) {
    parts.push({ key: "rank", node: <span className="text-white/30">Rank #{tierRank}</span> })
  } else if (earned && tier !== undefined && def.tiers) {
    parts.push({ key: "tier", node: <span className="text-white/30">Tier {tier}</span> })
  }
  if (!earned && progress?.next != null) {
    parts.push({
      key: "prog",
      node: (
        <span className="font-mono text-white/30">
          {progress.current} / {progress.next}
        </span>
      ),
    })
  }
  if (rare) {
    parts.push({ key: "rare", node: <span className="font-semibold text-unison-warn">Rare</span> })
  }
  if (parts.length === 0) return null

  return (
    <div className="mt-2 flex items-center justify-center gap-[7px] text-xs leading-none">
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 ? <span className="text-white/30">·</span> : null}
          {part.node}
        </Fragment>
      ))}
    </div>
  )
}

function BadgeTile({
  def,
  userBadge,
  rare,
  isCurrentTier,
  tierRank,
}: {
  def: BadgeDef
  userBadge: UserBadge | undefined
  rare: boolean
  isCurrentTier: boolean
  tierRank: number | null
}) {
  const earned = userBadge?.earned ?? false
  const tier = userBadge?.tier
  const progress = userBadge?.progress
  const pipsNext = !earned && progress?.next != null && progress.next <= 6 ? progress.next : null
  const { open } = useBadgeModal()

  return (
    <button
      type="button"
      data-earned={earned}
      onClick={() => open({ def, userBadge, rare, isCurrentTier, tierRank })}
      className="group relative grid w-[84px] cursor-pointer appearance-none grid-rows-subgrid row-span-3 gap-y-0 bg-transparent p-0 text-center text-inherit"
    >
      <div className="grid h-[60px] place-items-center">
        <img
          src={resolveBadgeImage(def, tier, earned ? "color" : "mono")}
          alt={def.name}
          draggable={false}
          className={cn(
            "size-12 select-none object-contain transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
            earned ? "group-hover:-translate-y-[3px] group-hover:scale-[1.07]" : "opacity-[0.32]",
          )}
        />
      </div>
      <div
        className={cn(
          "mt-2.5 text-xs font-medium leading-[1.25]",
          earned ? "text-unison-text-secondary" : "text-unison-text-muted",
        )}
      >
        {def.name}
      </div>
      <div>
        {pipsNext !== null && progress ? <Pips current={progress.current} next={pipsNext} /> : null}
        <BadgeMeta def={def} userBadge={userBadge} rare={rare} isCurrentTier={isCurrentTier} tierRank={tierRank} />
      </div>

      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 w-52 -translate-x-1/2 -translate-y-2 rounded-xl bg-[#1f2023] p-3 text-left opacity-0 shadow-[inset_0_0_0_1px_var(--color-unison-border-strong),0_10px_30px_rgba(0,0,0,0.45)] transition-opacity duration-150 ease-out group-hover:opacity-100">
        <div className="text-[13px] font-bold text-unison-text">{def.name}</div>
        <div
          className={cn(
            "mt-0.5 text-[11px] font-semibold",
            earned ? "text-unison-medal-gold" : "text-unison-text-muted",
          )}
        >
          {stateText(userBadge)}
        </div>
        <div className="mt-1.5 text-xs leading-[1.4] text-unison-text-secondary">{def.description}</div>
      </div>
    </button>
  )
}

export function BadgeWall({ gamification, catalogue, defaultOpen = true }: BadgeWallProps) {
  const { badges, display } = catalogue
  const userByKey = new Map(gamification.badges.map((ub) => [ub.key, ub]))
  const defByKey = new Map(badges.map((def) => [def.key, def]))

  // The shared community account sits outside the gamification system: it can only ever
  // hold the community badge, so its wall shows exactly that, not the aspirational catalogue.
  const communityOnly = gamification.badges.some((b) => b.key === "community" && b.earned)
  const sourceDefs = communityOnly
    ? gamification.badges.map((b) => defByKey.get(b.key)).filter((def): def is BadgeDef => def !== undefined)
    : badges

  const groups = groupBadgesByCategory(sourceDefs, display.categoryOrder)
    .map((group) => ({
      category: group.category,
      badges: group.badges.filter((def) => !(def.secret && !(userByKey.get(def.key)?.earned ?? false))),
    }))
    .filter((group) => group.badges.length > 0)

  const { earned, total } = gamification.counts
  const barPct = total > 0 ? Math.round((earned / total) * 100) : 0

  const summary = (
    <div className="flex items-center gap-2.5 text-[13px] text-unison-text-muted">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.08]">
        <span
          style={{ width: `${barPct}%` }}
          className="pf-bar-fill block h-full rounded-full bg-gradient-to-r from-[#ffb020] to-unison-medal-gold"
        />
      </div>
      <span>
        <b className="font-bold text-unison-medal-gold">
          <OdometerNumber value={earned} />
        </b>{" "}
        of {total} unlocked
      </span>
    </div>
  )

  return (
    <CollapsibleSection title="Badges" summary={summary} defaultOpen={defaultOpen} className="mt-2">
      <div className="space-y-8">
        {groups.map((group, i) => {
          const earnedInGroup = group.badges.filter((def) => userByKey.get(def.key)?.earned).length
          return (
            <div key={group.category} className="pf-group" style={{ animationDelay: `${i * 0.07}s` }}>
              <div className="mb-5 flex items-center gap-3">
                <h3 className="text-[13px] font-semibold text-unison-text-secondary">{titleCase(group.category)}</h3>
                <span className="text-xs text-white/30">
                  {earnedInGroup} of {group.badges.length}
                </span>
                <span className="h-px flex-1 bg-unison-border" />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,84px)] gap-x-7 gap-y-6">
                {group.badges.map((def) => {
                  const userBadge = userByKey.get(def.key)
                  const isCurrentTier = group.category === "tier" && def.key === gamification.tier
                  return (
                    <BadgeTile
                      key={def.key}
                      def={def}
                      userBadge={userBadge}
                      rare={isRareBadge(def, display.rarityThreshold)}
                      isCurrentTier={isCurrentTier}
                      tierRank={gamification.tierRank}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}
