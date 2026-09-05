import { BadgeIcon } from "@/components/BadgeIcon"
import { useBadgeCatalogue } from "@/components/BadgeCatalogueContext"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { TierChip } from "@/components/TierChip"
import { groupBadgesByCategory, isRareBadge } from "@/lib/badge-view"
import { cn } from "@/lib/cn"
import { formatExact, formatRank } from "@/lib/format"
import type { BadgeDef, BadgeDisplay, ExpertiseEntry, UserBadge, UserGamification } from "@/lib/types"

interface BadgeWallProps {
  gamification: UserGamification
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function GamificationHeader({ gamification }: { gamification: UserGamification }) {
  const { level, xp, xpForNext, tier, tierRank, counts } = gamification
  const pct = xpForNext !== null && xpForNext > 0 ? Math.min(100, Math.round((xp / xpForNext) * 100)) : 100
  return (
    <div className="space-y-3 rounded-lg border border-unison-border bg-unison-bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg text-unison-text">Level {level}</span>
          {tier !== null ? <TierChip tier={tier} rank={tierRank} /> : null}
        </div>
        <span className="font-mono text-xs text-unison-text-muted">
          {formatExact(counts.earned)} / {formatExact(counts.total)} badges
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-unison-bg-hover">
          <div className="h-full rounded-full bg-unison-medal-gold" style={{ width: `${pct}%` }} />
        </div>
        <p className="font-mono text-[10px] text-unison-text-muted">
          {xpForNext !== null
            ? `${formatExact(xp)} / ${formatExact(xpForNext)} XP`
            : `${formatExact(xp)} XP · max level`}
        </p>
      </div>
    </div>
  )
}

function RarePill() {
  return (
    <span className="rounded bg-unison-bg-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-unison-warn">
      Rare
    </span>
  )
}

function ProgressBar({ current, next }: { current: number; next: number | null }) {
  const pct = next !== null && next > 0 ? Math.min(100, Math.round((current / next) * 100)) : 0
  return (
    <div className="w-full space-y-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-unison-bg-hover">
        <div className="h-full rounded-full bg-unison-text-muted" style={{ width: `${pct}%` }} />
      </div>
      <p className="font-mono text-[9px] text-unison-text-muted">
        {next !== null ? `${formatExact(current)} / ${formatExact(next)}` : formatExact(current)}
      </p>
    </div>
  )
}

function BadgeTile({ badge, userBadge, display }: { badge: BadgeDef; userBadge?: UserBadge; display: BadgeDisplay }) {
  const earned = userBadge?.earned ?? false
  const tier = userBadge?.tier
  const rare = isRareBadge(badge, display.rarityThreshold)
  return (
    <div
      data-earned={earned}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-unison-border bg-unison-bg-elevated p-3 text-center",
        !earned && "opacity-80",
      )}
    >
      <BadgeIcon badge={badge} tier={tier} variant={earned ? "color" : "mono"} earned={earned} size="md" />
      <p className={cn("text-xs font-medium", earned ? "text-unison-text" : "text-unison-text-muted")}>{badge.name}</p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {earned && tier !== undefined ? (
          <span className="rounded bg-unison-bg-hover px-1.5 py-0.5 font-mono text-[9px] text-unison-text-secondary">
            Tier {tier}
          </span>
        ) : null}
        {rare ? <RarePill /> : null}
      </div>
      {!earned && userBadge?.progress ? (
        <ProgressBar current={userBadge.progress.current} next={userBadge.progress.next} />
      ) : null}
    </div>
  )
}

function BadgeShowcase({
  gamification,
  defByKey,
  userByKey,
  display,
}: {
  gamification: UserGamification
  defByKey: Map<string, BadgeDef>
  userByKey: Map<string, UserBadge>
  display: BadgeDisplay
}) {
  const featured = gamification.featured
    .slice(0, display.featuredMax)
    .map((key) => defByKey.get(key))
    .filter((def): def is BadgeDef => def !== undefined)

  if (featured.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-unison-text">Featured</h3>
      <div data-testid="badge-showcase" className="flex flex-wrap gap-4">
        {featured.map((def) => (
          <div key={def.key} className="flex w-20 flex-col items-center gap-1.5 text-center">
            <BadgeIcon badge={def} tier={userByKey.get(def.key)?.tier} variant="color" size="lg" />
            <p className="text-[11px] font-medium text-unison-text">{def.name}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExpertiseStrip({ entries }: { entries: ExpertiseEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-unison-text">Top expertise</h3>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <span
            key={`${entry.scope}:${entry.name}`}
            className="inline-flex items-center gap-2 rounded-lg border border-unison-border bg-unison-bg-elevated px-3 py-1.5"
          >
            <span className="text-[10px] uppercase tracking-wider text-unison-text-muted">
              {titleCase(entry.scope)}
            </span>
            <span className="text-sm text-unison-text">{entry.name}</span>
            <span className="font-mono text-xs text-unison-text-secondary">{formatRank(entry.rank)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function BadgeWall({ gamification }: BadgeWallProps) {
  const catalogue = useBadgeCatalogue()

  if (catalogue.status === "loading") return <LoadingPlaceholder rows={2} />
  if (catalogue.status === "error") {
    return <EmptyState title="Badges unavailable" hint={catalogue.error.message} />
  }

  const { badges, display } = catalogue.data
  const defByKey = new Map(badges.map((def) => [def.key, def]))
  const userByKey = new Map(gamification.badges.map((ub) => [ub.key, ub]))
  const groups = groupBadgesByCategory(badges, display.categoryOrder).map((group) => ({
    category: group.category,
    badges: group.badges.filter((def) => !(def.secret && !(userByKey.get(def.key)?.earned ?? false))),
  }))

  return (
    <div className="space-y-6">
      <GamificationHeader gamification={gamification} />
      <BadgeShowcase gamification={gamification} defByKey={defByKey} userByKey={userByKey} display={display} />
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-unison-text">Badges</h3>
        {groups.map((group) =>
          group.badges.length === 0 ? null : (
            <div key={group.category} className="space-y-2">
              <h4 className="text-[10px] uppercase tracking-wider text-unison-text-muted">
                {titleCase(group.category)}
              </h4>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {group.badges.map((def) => (
                  <BadgeTile key={def.key} badge={def} userBadge={userByKey.get(def.key)} display={display} />
                ))}
              </div>
            </div>
          ),
        )}
      </div>
      {gamification.topExpertise ? <ExpertiseStrip entries={gamification.topExpertise} /> : null}
    </div>
  )
}
