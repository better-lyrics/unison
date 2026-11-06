import "./profile.css"
import { IconEye } from "@tabler/icons-react"
import { type Ref, useCallback, useRef, useState } from "react"
import { useOptionalSession } from "@/auth/useSession"
import { usePageArt } from "@/components/PageArt"
import { BadgeCatalogueProvider, useBadgeCatalogue } from "@/components/BadgeCatalogueContext"
import { BadgeModalProvider } from "@/components/BadgeModalContext"
import { BadgeWall } from "@/components/BadgeWall"
import { EmptyState } from "@/components/EmptyState"
import { FeaturedBadgeEditor } from "@/components/FeaturedBadgeEditor"
import { OwnerControls } from "@/components/OwnerControls"
import { BannerPicker } from "@/components/profile/BannerPicker"
import { ProfileCard } from "@/components/profile/ProfileCard"
import { ProfileSide } from "@/components/profile/ProfileSide"
import { SectionHeading } from "@/components/profile/SectionHeading"
import { PROFILE_STAGE } from "@/components/profile/layout"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { SubmissionsList } from "@/components/SubmissionsList"
import { glassActionClass, glassClass } from "@/components/ui"
import { setAsyncData, useAsyncData } from "@/hooks/useAsyncData"
import { useProfileArt } from "@/hooks/useProfileArt"
import { fetchUserBadges, fetchUserRank } from "@/lib/api"
import { cn } from "@/lib/cn"
import { formatRank, titleCase } from "@/lib/format"
import { languageName } from "@/lib/language"
import type { BadgeCatalogue, ExpertiseEntry, UserGamification, UserRankResponse } from "@/lib/types"

interface UserProfileViewProps {
  keyId: string
}

const PANEL = cn(glassClass, "rounded-[22px] bg-[rgba(15,14,19,0.34)] p-6 [text-shadow:none]")

function ExpertiseStrip({ entries }: { entries: ExpertiseEntry[] }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="Top expertise" />
      <div className="flex flex-wrap gap-2 [text-shadow:none]">
        {entries.map((entry) => (
          <span
            key={`${entry.scope}:${entry.name}`}
            className={cn(
              glassClass,
              "inline-flex items-baseline gap-2 rounded-xl px-3.5 py-2.5 backdrop-blur-[16px] [corner-shape:superellipse(1.6)]",
            )}
          >
            <span className="text-xs text-(--ink-3)">{titleCase(entry.scope)}</span>
            <span className="text-sm font-bold">
              {entry.scope === "language" ? languageName(entry.name) : entry.name}
            </span>
            <span className="text-[13px] font-bold text-unison-medal-gold tabular-nums">{formatRank(entry.rank)}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function PreviewBar({ onExit }: { onExit: () => void }) {
  return (
    <div className={cn(PANEL, "t-reveal mb-6 flex items-center justify-between gap-3 py-2.5 pr-2.5 pl-4")}>
      <span className="flex items-center gap-2 text-sm text-(--ink-2)">
        <IconEye className="size-4" stroke={1.7} />
        You're previewing your public profile.
      </span>
      <button type="button" onClick={onExit} className={cn(glassActionClass, "h-9 px-3.5 text-[13px]")}>
        Exit preview
      </button>
    </div>
  )
}

function OwnerBlock({
  ref,
  gamification,
  catalogue,
  onGamificationChange,
  onPreview,
  showDiscord,
  onProfileChange,
}: {
  ref: Ref<HTMLElement>
  gamification: UserGamification | null
  catalogue: BadgeCatalogue | null
  onGamificationChange: (updated: UserGamification) => void
  onPreview: () => void
  showDiscord: boolean
  onProfileChange: () => Promise<void>
}) {
  return (
    <section ref={ref} id="edit-profile" className="flex scroll-mt-8 flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-xl font-bold tracking-[-0.01em]">Edit profile</h2>
        <button type="button" onClick={onPreview} className={cn(glassActionClass, "ml-auto h-9 pr-3.5 pl-3 text-[13px]")}>
          <IconEye className="size-4" stroke={1.7} />
          Preview as a visitor
        </button>
      </div>
      <div className={cn(PANEL, "space-y-6")}>
        {gamification && catalogue ? (
          <FeaturedBadgeEditor gamification={gamification} catalogue={catalogue} onSaved={onGamificationChange} />
        ) : null}
        <OwnerControls showDiscord={showDiscord} onProfileChange={onProfileChange} />
      </div>
    </section>
  )
}

function ProfileBody({
  keyId,
  rank,
  gamification,
  catalogue,
  isOwner,
  onGamificationChange,
  onProfileChange,
}: {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
  catalogue: BadgeCatalogue | null
  isOwner: boolean
  onGamificationChange: (updated: UserGamification) => void
  onProfileChange: () => Promise<void>
}) {
  const art = useProfileArt(rank)
  usePageArt(art.wash)
  const [preview, setPreview] = useState(false)
  const editRef = useRef<HTMLElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [bannerAnchor, setBannerAnchor] = useState<HTMLElement | null>(null)
  const owner = isOwner && !preview

  const editProfile = () => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    editRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" })
  }

  return (
    <div>
      {owner && bannerAnchor ? (
        <BannerPicker
          ref={pickerRef}
          anchor={bannerAnchor}
          keyId={keyId}
          current={rank.banner?.videoId ?? null}
          onSaved={onProfileChange}
        />
      ) : null}
      {isOwner && preview ? <PreviewBar onExit={() => setPreview(false)} /> : null}
      <section className={PROFILE_STAGE}>
        <div className="w-full max-w-[400px]">
          <ProfileCard
            keyId={keyId}
            rank={rank}
            gamification={gamification}
            catalogue={catalogue}
            art={art}
            onChangeBanner={
              owner && rank.ranked && rank.submissionCount > 0
                ? (anchor) => {
                    setBannerAnchor(anchor)
                    pickerRef.current?.showPopover()
                  }
                : undefined
            }
          />
        </div>
        <ProfileSide keyId={keyId} rank={rank} gamification={gamification} owner={owner} onEditProfile={editProfile} />
      </section>

      <div className="flex flex-col gap-14 pb-[108px]">
        <SubmissionsList keyId={keyId} total={rank.ranked ? rank.submissionCount : undefined} owner={owner} />
        {gamification?.topExpertise && gamification.topExpertise.length > 0 ? (
          <ExpertiseStrip entries={gamification.topExpertise} />
        ) : null}
        {gamification && catalogue ? (
          <BadgeWall gamification={gamification} catalogue={catalogue} />
        ) : (
          <EmptyState title="Achievements unavailable" hint="Achievements couldn't be loaded right now." />
        )}
        {owner ? (
          <OwnerBlock
            ref={editRef}
            gamification={gamification}
            catalogue={catalogue}
            onGamificationChange={onGamificationChange}
            onPreview={() => setPreview(true)}
            showDiscord={rank.discord !== undefined}
            onProfileChange={onProfileChange}
          />
        ) : null}
      </div>
    </div>
  )
}

function ProfileGate({
  keyId,
  rank,
  rankError,
  rankLoading,
  gamification,
  gamSettled,
  isOwner,
  onGamificationChange,
  onProfileChange,
}: {
  keyId: string
  rank: UserRankResponse | null
  rankError: Error | null
  rankLoading: boolean
  gamification: UserGamification | null
  gamSettled: boolean
  isOwner: boolean
  onGamificationChange: (updated: UserGamification) => void
  onProfileChange: () => Promise<void>
}) {
  const catalogueState = useBadgeCatalogue()
  const catalogue = catalogueState.status === "success" ? catalogueState.data : null

  if (rankError) return <EmptyState title="Could not load profile" hint={rankError.message} />
  if (rankLoading || !rank || !gamSettled || catalogueState.status === "loading") {
    return <ProfileSkeleton owner={isOwner} />
  }

  return (
    <ProfileBody
      keyId={keyId}
      rank={rank}
      gamification={gamification}
      catalogue={catalogue}
      isOwner={isOwner}
      onGamificationChange={onGamificationChange}
      onProfileChange={onProfileChange}
    />
  )
}

export function UserProfileView({ keyId }: UserProfileViewProps) {
  const rankFetcher = useCallback(() => fetchUserRank(keyId), [keyId])
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)
  const badgesFetcher = useCallback(() => fetchUserBadges(keyId), [keyId])
  const gamification = useAsyncData(badgesFetcher, `user:badges:${keyId}`)

  const session = useOptionalSession()
  const isOwner = session?.status === "signed-in" && session.identity.keyId === keyId
  const ownAvatarUrl =
    session?.status === "signed-in" && session.identity.keyId === keyId ? session.identity.avatarUrl : undefined

  const [override, setOverride] = useState<UserGamification | null>(null)
  const onGamificationChange = useCallback((updated: UserGamification) => {
    setOverride(updated)
    setAsyncData(`user:badges:${updated.keyId}`, updated)
  }, [])

  const [rankOverride, setRankOverride] = useState<UserRankResponse | null>(null)
  const onProfileChange = useCallback(async () => {
    const fresh = await fetchUserRank(keyId)
    setAsyncData(`leaderboard:user:${keyId}`, fresh)
    setRankOverride(fresh)
  }, [keyId])

  const fetchedRank = rankOverride?.keyId === keyId ? rankOverride : rank.status === "success" ? rank.data : null
  const shownRank =
    fetchedRank && ownAvatarUrl !== undefined ? { ...fetchedRank, avatarUrl: ownAvatarUrl } : fetchedRank
  const fetched = gamification.status === "success" ? gamification.data : null
  const gam = override?.keyId === keyId ? override : fetched
  const gamSettled = override?.keyId === keyId || gamification.status !== "loading"

  return (
    <BadgeCatalogueProvider>
      <BadgeModalProvider>
        <ProfileGate
          keyId={keyId}
          rank={shownRank}
          rankError={rank.status === "error" ? rank.error : null}
          rankLoading={rank.status === "loading"}
          gamification={gam}
          gamSettled={gamSettled}
          isOwner={isOwner}
          onGamificationChange={onGamificationChange}
          onProfileChange={onProfileChange}
        />
      </BadgeModalProvider>
    </BadgeCatalogueProvider>
  )
}
