import "./profile.css"
import { useCallback } from "react"
import { BadgeCatalogueProvider, useBadgeCatalogue } from "@/components/BadgeCatalogueContext"
import { BadgeWall } from "@/components/BadgeWall"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { ProfileHeader } from "@/components/ProfileHeader"
import { StatPills } from "@/components/StatPills"
import { SubmissionsList } from "@/components/SubmissionsList"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserBadges, fetchUserRank } from "@/lib/api"
import { formatRank } from "@/lib/format"
import type { ExpertiseEntry, UserGamification, UserRankResponse } from "@/lib/types"

interface UserProfileViewProps {
  keyId: string
}

function ExpertiseStrip({ entries }: { entries: ExpertiseEntry[] }) {
  return (
    <section className="mt-12">
      <h2 className="mb-5 text-[17px] font-bold tracking-[-0.01em] text-unison-text">Top expertise</h2>
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
    </section>
  )
}

function ProfileBody({
  keyId,
  rank,
  gamification,
}: {
  keyId: string
  rank: UserRankResponse
  gamification: UserGamification | null
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

      <div className="mt-12">
        {gamification && catalogue ? (
          <BadgeWall gamification={gamification} catalogue={catalogue} />
        ) : catalogueState.status === "error" ? (
          <EmptyState title="Achievements unavailable" hint={catalogueState.error.message} />
        ) : (
          <LoadingPlaceholder rows={2} />
        )}
      </div>

      {gamification?.topExpertise && gamification.topExpertise.length > 0 ? (
        <ExpertiseStrip entries={gamification.topExpertise} />
      ) : null}

      <section className="mt-12">
        <SubmissionsList keyId={keyId} />
      </section>
    </div>
  )
}

export function UserProfileView({ keyId }: UserProfileViewProps) {
  const rankFetcher = useCallback(() => fetchUserRank(keyId), [keyId])
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)
  const badgesFetcher = useCallback(() => fetchUserBadges(keyId), [keyId])
  const gamification = useAsyncData(badgesFetcher, `user:badges:${keyId}`)

  if (rank.status === "loading") return <LoadingPlaceholder />
  if (rank.status === "error") return <EmptyState title="Could not load profile" hint={rank.error.message} />

  const gam = gamification.status === "success" ? gamification.data : null

  return (
    <BadgeCatalogueProvider>
      <ProfileBody keyId={keyId} rank={rank.data} gamification={gam} />
    </BadgeCatalogueProvider>
  )
}
