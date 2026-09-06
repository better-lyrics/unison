import { IconBrandDiscordFilled, IconCheck, IconShare, IconStarFilled } from "@tabler/icons-react"
import { useState } from "react"
import { useBadgeModal } from "@/components/BadgeModalContext"
import { OdometerNumber } from "@/components/OdometerNumber"
import { TierChip } from "@/components/TierChip"
import { isRareBadge, resolveBadgeImage } from "@/lib/badge-view"
import { dicebearThumbsDataUri } from "@/lib/avatar"
import { cn } from "@/lib/cn"
import { toHandle } from "@/lib/handle"
import { levelProgress } from "@/lib/level"
import type { BadgeCatalogue, UserGamification, UserRankResponse } from "@/lib/types"

const RING_CIRCUMFERENCE = 277

interface ProfileHeaderProps {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
  catalogue: BadgeCatalogue | null
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return [copied, copy]
}

interface ProfileLink {
  handle: string | null
  path: string
  url: string
  label: string
}

function profileLink(displayName: string, keyId: string): ProfileLink {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const host = typeof window !== "undefined" ? window.location.host : "unison.boidu.dev"
  const handle = toHandle(displayName)
  if (handle.length === 0) {
    const path = `/curator/${keyId}`
    return { handle: null, path, url: `${origin}${path}`, label: `${keyId.slice(0, 6)}…${keyId.slice(-6)}` }
  }
  const path = `/u/${handle}`
  return { handle, path, url: `${origin}${path}`, label: `${host}${path}` }
}

function FeaturedBadges({
  gamification,
  catalogue,
}: {
  gamification: UserGamification
  catalogue: BadgeCatalogue
}) {
  const userByKey = new Map(gamification.badges.map((b) => [b.key, b]))
  const defByKey = new Map(catalogue.badges.map((d) => [d.key, d]))
  const featured = gamification.featured
    .slice(0, catalogue.display.featuredMax)
    .map((key) => defByKey.get(key))
    .filter((def): def is NonNullable<typeof def> => def !== undefined)
  const { open } = useBadgeModal()

  if (featured.length === 0) return null

  return (
    <span data-testid="featured-badges" className="pf-featured flex items-center gap-1.5 sm:pl-3.5">
      {featured.map((def, i) => {
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
            className="inline-flex cursor-pointer appearance-none bg-transparent p-0"
          >
            <img
              src={resolveBadgeImage(def, tier, "color")}
              alt={def.name}
              draggable={false}
              style={{ animationDelay: `${0.35 + i * 0.07}s` }}
              className="pf-fbadge size-7 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-0.5 hover:scale-110"
            />
          </button>
        )
      })}
    </span>
  )
}

export function ProfileHeader({ keyId, rank, gamification, catalogue }: ProfileHeaderProps) {
  const [shareCopied, copyShare] = useCopied()
  const link = profileLink(rank.displayName, keyId)

  const progress = gamification ? levelProgress(gamification.xp, gamification.xpForNext) : null
  const ringOffset = progress ? RING_CIRCUMFERENCE * (1 - progress.pct) : RING_CIRCUMFERENCE
  const tierDef =
    gamification?.tier && catalogue ? catalogue.badges.find((d) => d.key === gamification.tier) : undefined
  const gemSrc = tierDef ? resolveBadgeImage(tierDef, undefined, "color") : undefined

  const renderShare = (className: string) => (
    <button
      type="button"
      onClick={() => copyShare(link.url)}
      className={cn(
        "cursor-pointer items-center gap-2 rounded-lg bg-unison-surface font-medium text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text active:scale-[0.96]",
        className,
      )}
    >
      {shareCopied ? <IconCheck className="size-3" stroke={1.7} /> : <IconShare className="size-3" stroke={1.7} />}
      {shareCopied ? "Copied" : "Share"}
    </button>
  )

  return (
    <header className="flex items-start gap-5">
      <div className="relative size-[92px] shrink-0">
        <svg
          className="absolute inset-0"
          style={{ transform: "rotate(-90deg)" }}
          width="92"
          height="92"
          viewBox="0 0 92 92"
          aria-hidden="true"
        >
          <circle cx="46" cy="46" r="44" fill="none" strokeWidth="4" stroke="rgba(255,255,255,0.1)" />
          {progress ? (
            <circle
              className="pf-arc"
              cx="46"
              cy="46"
              r="44"
              fill="none"
              strokeWidth="4"
              stroke="var(--color-unison-medal-gold)"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
            />
          ) : null}
        </svg>
        <img
          src={dicebearThumbsDataUri(keyId)}
          alt=""
          className="absolute top-2 left-2 block size-[76px] rounded-full bg-unison-bg-elevated"
        />
        {rank.discordLinked ? (
          <span
            title="Discord linked"
            className="absolute right-0 bottom-0 z-10 grid size-[26px] place-items-center rounded-full border-4 border-unison-bg bg-[#5865f2]"
          >
            <IconBrandDiscordFilled className="size-3.5 text-white" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.015em] text-unison-text">
            {rank.displayName}
          </h1>
          {gamification && catalogue ? <FeaturedBadges gamification={gamification} catalogue={catalogue} /> : null}
          {renderShare("hidden sm:ml-auto sm:inline-flex py-2 pr-4 pl-3 text-[13px]")}
        </div>

        {rank.community || rank.ranked || gamification ? (
          <div className="mt-10 flex flex-wrap items-center gap-2.5 text-[13px] max-sm:-ml-[112px] max-sm:w-[calc(100%_+_112px)] sm:mt-3.5">
            {rank.community ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[rgba(255,200,61,0.12)] px-[11px] text-xs font-semibold text-unison-medal-gold">
                <IconStarFilled className="size-3.5" />
                Community account
              </span>
            ) : (
              <>
                {gamification?.tier ? (
                  <TierChip tier={gamification.tier} rank={gamification.tierRank} gemSrc={gemSrc} />
                ) : null}
                {rank.ranked ? (
                  <span className="inline-flex h-7 items-center rounded-full bg-[rgba(255,200,61,0.12)] px-[11px] text-xs font-semibold text-unison-medal-gold">
                    Rank #{rank.rank}
                  </span>
                ) : null}
              </>
            )}
            {renderShare("ml-auto inline-flex h-7 pr-4 pl-3 text-[13px] sm:hidden")}
            {!rank.community && gamification ? (
              <span className="w-full text-unison-text-muted sm:ml-auto sm:w-auto">
                Level{" "}
                <b className="font-bold text-unison-text-secondary">
                  <OdometerNumber value={gamification.level} />
                </b>
                <span className="mx-[7px] text-white/30">·</span>
                {progress?.atMax ? (
                  "Max level"
                ) : (
                  <>
                    <OdometerNumber value={progress?.remaining ?? 0} /> XP to Level {gamification.level + 1}
                  </>
                )}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  )
}
