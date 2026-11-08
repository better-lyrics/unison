import { IconPhoto } from "@tabler/icons-react"
import { type CSSProperties, useCallback, useEffect, useState } from "react"
import { ArtBackground } from "@/components/ArtBackground"
import { BadgeArt } from "@/components/BadgeArt"
import { BetterLyricsLogo } from "@/components/BetterLyricsLogo"
import { useBadgeModal } from "@/components/BadgeModalContext"
import { glassActionClass, glassClass } from "@/components/ui"
import { XpAvatar } from "@/components/XpAvatar"
import { Bone } from "@/components/skeleton"
import { paletteVars, useAccent } from "@/hooks/useArtPalette"
import { useBadgeArt } from "@/hooks/useBadgeImage"
import type { ProfileArt } from "@/hooks/useProfileArt"
import { isRareBadge, resolveBadgeImage } from "@/lib/badge-view"
import { SwapLabel } from "@/components/SwapLabel"
import { cn } from "@/lib/cn"
import { formatCompact, titleCase } from "@/lib/format"
import { levelProgress } from "@/lib/level"
import type { BadgeCatalogue, UserGamification, UserRankResponse } from "@/lib/types"

const NAME_SIZE = {
  l: "text-[40px]",
  m: "text-[33.6px]",
  s: "text-[28px]",
}

const PILL = cn(
  glassClass,
  "inline-flex h-9 items-center whitespace-nowrap rounded-full text-sm font-bold backdrop-blur-[24px] [text-shadow:none]",
)

const CARD_DITHERING = 0.03
const CARD_ART_WAIT_MS = 3000

const RIM =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06)]"

function nameSize(name: string): keyof typeof NAME_SIZE {
  if (name.length <= 12) return "l"
  return name.length <= 20 ? "m" : "s"
}

interface ProfileCardProps {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
  catalogue: BadgeCatalogue | null
  art: ProfileArt
  onChangeBanner?: (anchor: HTMLElement) => void
}

function Standing({ tier, rank }: { tier: string; rank: number | null }) {
  const gem = useBadgeArt()(tier)
  const name = titleCase(tier)
  return (
    <span
      title={rank === null ? name : `${name}, rank #${rank}`}
      className={cn(PILL, "gap-1.5 pr-3 pl-[9px] text-[13px]")}
    >
      <BadgeArt src={gem?.src ?? null} silhouette={gem?.silhouette ?? null} className="size-5" />
      {name}
      {rank === null ? null : <b className="ml-0.5 text-unison-medal-gold">#{rank}</b>}
    </span>
  )
}

function FeaturedBadges({ gamification, catalogue }: { gamification: UserGamification; catalogue: BadgeCatalogue }) {
  const { open } = useBadgeModal()
  const userByKey = new Map(gamification.badges.map((b) => [b.key, b]))
  const defByKey = new Map(catalogue.badges.map((d) => [d.key, d]))
  const featured = gamification.featured
    .slice(0, catalogue.display.featuredMax)
    .map((key) => defByKey.get(key))
    .filter((def): def is NonNullable<typeof def> => def !== undefined)

  if (featured.length === 0) return null

  return (
    <div data-testid="featured-badges" className="mt-3.5 flex gap-1.5">
      {featured.map((def) => {
        const userBadge = userByKey.get(def.key)
        const tier = userBadge?.tier
        return (
          <button
            key={def.key}
            type="button"
            onClick={() =>
              open({
                def,
                userBadge,
                rare: isRareBadge(def, catalogue.display.rarityThreshold),
                isCurrentTier: def.key === gamification.tier,
                tierRank: gamification.tierRank,
              })
            }
            title={tier !== undefined ? `${def.name}, tier ${tier}` : def.name}
            className="relative inline-flex cursor-pointer transition-[scale] duration-150 ease-out after:absolute after:-inset-x-[3px] after:-inset-y-1.5 active:scale-[0.96]"
          >
            <BadgeArt
              src={resolveBadgeImage(def, tier, "color")}
              silhouette={resolveBadgeImage(def, tier, "silhouette")}
              alt={def.name}
              className="size-7 transition-[translate,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-110"
            />
          </button>
        )
      })}
    </div>
  )
}

function Stat({ value, label, testId }: { value: string; label: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[22px] font-black leading-none tracking-[-0.03em] tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs text-(--ink-3)">{label}</div>
    </div>
  )
}

export function ProfileCard({ keyId, rank, gamification, catalogue, art, onChangeBanner }: ProfileCardProps) {
  const progress = gamification ? levelProgress(gamification.xp, gamification.xpForNext, gamification.xpFloor) : null
  const tier = rank.community ? null : (gamification?.tier ?? null)
  const [ready, setReady] = useState(false)
  const [brokenBanner, setBrokenBanner] = useState<string | null>(null)
  const markReady = useCallback(() => setReady(true), [])
  const palette = paletteVars(useAccent(art.wash)) as CSSProperties
  useEffect(() => {
    const timer = window.setTimeout(markReady, CARD_ART_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [markReady])

  return (
    <div className="relative">
      {ready ? null : <Bone className="absolute inset-0 rounded-[28px]" />}
      <div
        className={cn(
          "art-palette relative isolate aspect-[5/7] w-full overflow-hidden rounded-[28px] shadow-[0_40px_100px_rgba(0,0,0,0.55)] transition-opacity duration-(--reveal-dur) ease-in-out motion-reduce:transition-none",
          RIM,
          !ready && "opacity-0",
        )}
        style={palette}
        inert={!ready}
      >
        <ArtBackground src={art.wash} contained dithering={CARD_DITHERING} onReady={markReady} />
        {art.banner && art.banner !== brokenBanner ? (
          <div key={art.banner} aria-hidden="true" className="t-reveal absolute inset-x-0 top-0 isolate h-[64%] overflow-hidden">
            <img src={art.banner} alt="" onError={() => setBrokenBanner(art.banner)} className="pf-banner-soft" />
            <img src={art.banner} alt="" className="pf-banner-sharp" />
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,9,13,calc(var(--scrim)*0.4)),transparent_22%,transparent_42%,rgba(10,9,13,calc(var(--scrim)+0.1)))]"
        />
        <div className="absolute inset-0 flex min-w-0 flex-col p-6">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(PILL, "gap-2 pr-3.5 pl-[9px]")}>
              <BetterLyricsLogo size={20} />
              Unison
            </span>
            {tier ? <Standing tier={tier} rank={rank.ranked ? rank.rank : null} /> : null}
          </div>
          <XpAvatar
            avatarUrl={art.avatar}
            keyId={keyId}
            level={gamification?.level}
            progress={progress?.pct ?? null}
            tiered={Boolean(tier)}
            className="mt-auto size-[116px] shrink-0"
          />
          <h1
            title={rank.displayName}
            className={cn(
              NAME_SIZE[nameSize(rank.displayName)],
              "mt-3.5 -mr-[0.08em] -mb-[0.08em] line-clamp-2 pr-[0.08em] pb-[0.08em] font-black leading-[1.08] tracking-[-0.035em] text-balance [overflow-wrap:anywhere]",
            )}
          >
            {rank.displayName}
          </h1>
          {rank.handle ? <p className="mt-2.5 text-sm font-medium text-(--ink-3)">@{rank.handle}</p> : null}
          {gamification && catalogue ? <FeaturedBadges gamification={gamification} catalogue={catalogue} /> : null}
          <div className="mt-5 flex gap-[22px] pt-[18px] shadow-[inset_0_1px_0_var(--tw-shadow-color,rgba(255,255,255,0.03))]">
            <Stat value={String(rank.ranked ? rank.submissionCount : 0)} label="Songs synced" testId="stat-submissions" />
            <Stat value={formatCompact(rank.ranked ? rank.totalUpvotes : 0)} label="Upvotes" testId="stat-upvotes" />
            {gamification ? (
              <Stat value={String(gamification.counts.earned)} label="Badges" testId="stat-badges" />
            ) : null}
          </div>
        </div>
        {onChangeBanner ? (
          <div className="group/banner absolute inset-x-0 top-0 h-[58%]">
            <button
              type="button"
              onClick={(event) => onChangeBanner(event.currentTarget)}
              className={cn(
                glassActionClass,
                "absolute top-16 right-4 pl-4 opacity-0 backdrop-blur-[20px] transition-[opacity,background-color,scale] group-focus-within/banner:opacity-100 group-hover/banner:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <IconPhoto className="size-[17px]" stroke={1.75} />
              <SwapLabel text={art.banner ? "Change banner" : "Add banner"} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
