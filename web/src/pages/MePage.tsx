import { useCallback } from "react"
import { Navigate } from "react-router-dom"
import { useSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { UserProfileView } from "@/components/UserProfileView"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserRank } from "@/lib/api"

function SignedInMe({ keyId }: { keyId: string }) {
  const rankFetcher = useCallback(() => fetchUserRank(keyId), [keyId])
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)

  if (rank.status === "loading") return <ProfileSkeleton owner />
  if (rank.status === "success" && rank.data.handle) {
    return <Navigate to={`/u/${rank.data.handle}`} replace />
  }

  return <UserProfileView keyId={keyId} />
}

export function MePage() {
  const session = useSession()

  if (session.status === "loading") {
    return (
      <LeaderboardSection title="Me">
        <LoadingPlaceholder />
      </LeaderboardSection>
    )
  }

  if (session.status !== "signed-in") {
    return <EmptyState title="Not signed in" hint="Sign in with Better Lyrics from the header to see your stats." />
  }

  return <SignedInMe keyId={session.identity.keyId} />
}
