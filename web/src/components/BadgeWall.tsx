import { useBadgeModal } from "@/components/BadgeModalContext"
import { OdometerNumber } from "@/components/OdometerNumber"
import { SectionHeading } from "@/components/profile/SectionHeading"
import { groupBadgesByCategory, isRareBadge, resolveBadgeImage } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import { titleCase } from "@/lib/format"
import type { BadgeCatalogue, BadgeDef, UserBadge, UserGamification } from "@/lib/types"
import { Fragment, type ReactNode } from "react"

interface BadgeWallProps {
  gamification: UserGamification
  catalogue: BadgeCatalogue
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
  const ink = earned ? "text-(--ink-3)" : "text-(--ink-4)"

  if (isCurrentTier && tierRank != null) {
    parts.push({ key: "rank", node: <span className={ink}>Rank #{tierRank}</span> })
  } else if (earned && tier !== undefined && def.tiers) {
    parts.push({ key: "tier", node: <span className={ink}>Tier {tier}</span> })
  }
  if (!earned && progress?.next != null) {
    parts.push({
      key: "prog",
      node: (
        <span className={cn("tabular-nums", ink)}>
          {progress.current} / {progress.next}
        </span>
      ),
    })
  }
  if (rare) {
    parts.push({ key: "rare", node: <span className="font-semibold text-unison-warn">Rare</span> })
  }
  if (parts.length === 0) {
    parts.push({ key: "state", node: <span className={ink}>{earned ? "Earned" : "Locked"}</span> })
  }

  return (
    <div className="mt-0.5 flex items-center justify-center gap-[7px] text-[11px] leading-none">
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 ? <span className={ink}>·</span> : null}
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
      className="group relative flex cursor-pointer hover:z-10 flex-col items-center gap-1.5 rounded-2xl bg-[rgba(15,14,19,0.22)] px-2 pt-3.5 pb-3 text-center backdrop-blur-[16px] transition-[background-color,scale] duration-150 ease-out [text-shadow:none] active:scale-[0.96] hover:bg-white/[0.08]"
    >
      <img
        src={resolveBadgeImage(def, tier, earned ? "color" : "silhouette")}
        alt={def.name}
        draggable={false}
        className={cn("size-[52px] select-none object-contain", !earned && "opacity-35")}
      />
      <span className={cn("text-xs font-bold leading-[1.25]", earned ? "text-unison-text" : "text-(--ink-dim)")}>
        {def.name}
      </span>
      {pipsNext !== null && progress ? <Pips current={progress.current} next={pipsNext} /> : null}
      <BadgeMeta def={def} userBadge={userBadge} rare={rare} isCurrentTier={isCurrentTier} tierRank={tierRank} />

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

export function BadgeWall({ gamification, catalogue }: BadgeWallProps) {
  const { badges, display } = catalogue
  const userByKey = new Map(gamification.badges.map((ub) => [ub.key, ub]))
  // The held tier is authoritative on `gamification.tier`, not the earned badge list.
  if (gamification.tier && !userByKey.has(gamification.tier)) {
    userByKey.set(gamification.tier, { key: gamification.tier, earned: true, featured: false })
  }
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

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title="Badges"
        meta={
          <>
            <b className="font-bold text-unison-medal-gold">
              <OdometerNumber value={earned} />
            </b>{" "}
            of {total} unlocked
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const earnedInGroup = group.badges.filter((def) => userByKey.get(def.key)?.earned).length
          return (
            <div key={group.category}>
              <div className="mb-2.5 flex gap-2 text-[13px] font-medium">
                <h3 className="text-(--ink-2)">{titleCase(group.category)}</h3>
                <span className="text-(--ink-3)">
                  {earnedInGroup} of {group.badges.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
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
    </section>
  )
}
