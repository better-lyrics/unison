import "./profile.css"
import { IconEye } from "@tabler/icons-react"
import { useCallback, useState } from "react"
import { useOptionalSession } from "@/auth/useSession"
import { BadgeCatalogueProvider, useBadgeCatalogue } from "@/components/BadgeCatalogueContext"
import { BadgeModalProvider } from "@/components/BadgeModalContext"
import { BadgeWall } from "@/components/BadgeWall"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { EmptyState } from "@/components/EmptyState"
import { FeaturedBadgeEditor } from "@/components/FeaturedBadgeEditor"
import { OwnerControls } from "@/components/OwnerControls"
import { ProfileHeader } from "@/components/ProfileHeader"
import { BadgesSkeleton, ProfileSkeleton } from "@/components/ProfileSkeleton"
import { StatPills } from "@/components/StatPills"
import { SubmissionsList } from "@/components/SubmissionsList"
import { setAsyncData, useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserBadges, fetchUserRank } from "@/lib/api"
import { formatRank } from "@/lib/format"
import type { BadgeCatalogue, ExpertiseEntry, UserGamification, UserRankResponse } from "@/lib/types"

interface UserProfileViewProps {
  keyId: string
}

function ExpertiseStrip({ entries }: { entries: ExpertiseEntry[] }) {
  return (
    <CollapsibleSection title="Top expertise" defaultOpen={false} className="mt-12">
      <div className="flex flex-wrap gap-2.5">
        {entries.map((entry) => (
          <span
            key={`${entry.scope}:${entry.name}`}
            className="inline-flex items-baseline gap-2 rounded-[10px] bg-[rgba(255,255,255,0.025)] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--color-unison-border)]"
          >
            <span className="text-xs capitalize text-unison-text-muted">{entry.scope}</span>
            <span className="text-sm font-semibold text-unison-text">{entry.name}</span>
            <span className="text-[12.5px] font-bold text-unison-medal-gold">{formatRank(entry.rank)}</span>
          </span>
        ))}
      </div>
    </CollapsibleSection>
  )
}

function OwnerBlock({
  gamification,
  catalogue,
  onGamificationChange,
}: {
  gamification: UserGamification | null
  catalogue: BadgeCatalogue | null
  onGamificationChange: (updated: UserGamification) => void
}) {
  const [preview, setPreview] = useState(false)

  if (preview) {
    return (
      <div className="mt-12 flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm text-unison-text-secondary">
          <IconEye className="size-4" stroke={1.7} />
          You're previewing your public profile.
        </span>
        <button
          type="button"
          onClick={() => setPreview(false)}
          className="cursor-pointer rounded-md bg-unison-bg-hover px-3 py-1.5 text-sm font-medium text-unison-text transition-colors hover:bg-unison-bg-elevated active:scale-[0.96]"
        >
          Exit preview
        </button>
      </div>
    )
  }

  return (
    <div className="mt-12 space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-unison-surface px-3 py-2 text-[13px] font-medium text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text active:scale-[0.96]"
        >
          <IconEye className="size-[15px]" stroke={1.7} />
          Preview as a visitor
        </button>
      </div>
      {gamification && catalogue ? (
        <FeaturedBadgeEditor gamification={gamification} catalogue={catalogue} onSaved={onGamificationChange} />
      ) : null}
      <OwnerControls />
    </div>
  )
}

function ProfileBody({
  keyId,
  rank,
  gamification,
  isOwner,
  onGamificationChange,
}: {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
  isOwner: boolean
  onGamificationChange: (updated: UserGamification) => void
}) {
  const catalogueState = useBadgeCatalogue()
  const catalogue = catalogueState.status === "success" ? catalogueState.data : null

  return (
    <div>
      <ProfileHeader keyId={keyId} rank={rank} gamification={gamification} catalogue={catalogue} />

      <div className="mt-6">
        {rank.ranked ? (
          <StatPills score={rank.score} submissions={rank.submissionCount} upvotes={rank.totalUpvotes} />
        ) : (
          <EmptyState
            title="No leaderboard activity yet"
            hint="Submit lyrics via Better Lyrics to start showing up on the leaderboard."
          />
        )}
      </div>

      {isOwner ? (
        <OwnerBlock gamification={gamification} catalogue={catalogue} onGamificationChange={onGamificationChange} />
      ) : null}

      <div className="mt-12">
        {gamification && catalogue ? (
          <BadgeWall gamification={gamification} catalogue={catalogue} defaultOpen={false} />
        ) : catalogueState.status === "error" ? (
          <EmptyState title="Achievements unavailable" hint={catalogueState.error.message} />
        ) : (
          <BadgesSkeleton />
        )}
      </div>

      {gamification?.topExpertise && gamification.topExpertise.length > 0 ? (
        <ExpertiseStrip entries={gamification.topExpertise} />
      ) : null}

      <div className="mt-12">
        <SubmissionsList keyId={keyId} />
      </div>
    </div>
  )
}

export function UserProfileView({ keyId }: UserProfileViewProps) {
  const rankFetcher = useCallback(() => fetchUserRank(keyId), [keyId])
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)
  const badgesFetcher = useCallback(() => fetchUserBadges(keyId), [keyId])
  const gamification = useAsyncData(badgesFetcher, `user:badges:${keyId}`)

  const session = useOptionalSession()
  const isOwner = session?.status === "signed-in" && session.identity.keyId === keyId

  const [override, setOverride] = useState<UserGamification | null>(null)
  const onGamificationChange = useCallback((updated: UserGamification) => {
    setOverride(updated)
    setAsyncData(`user:badges:${updated.keyId}`, updated)
  }, [])

  if (rank.status === "loading") return <ProfileSkeleton />
  if (rank.status === "error") return <EmptyState title="Could not load profile" hint={rank.error.message} />

  const fetched = gamification.status === "success" ? gamification.data : null
  const gam = override?.keyId === keyId ? override : fetched

  return (
    <BadgeCatalogueProvider>
      <BadgeModalProvider>
        <ProfileBody
          keyId={keyId}
          rank={rank.data}
          gamification={gam}
          isOwner={isOwner}
          onGamificationChange={onGamificationChange}
        />
      </BadgeModalProvider>
    </BadgeCatalogueProvider>
  )
}
