import { useCallback } from "react"
import { Navigate, useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { UserProfileView } from "@/components/UserProfileView"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserRank } from "@/lib/api"

// Redirects to the canonical /u/<handle> URL when the curator has a handle
// (a nickname). Curators without one keep this /curator/:keyId address.
export function UserPage() {
  const { keyId } = useParams<{ keyId: string }>()
  const rankFetcher = useCallback(
    () => (keyId ? fetchUserRank(keyId) : Promise.reject(new Error("no key"))),
    [keyId],
  )
  const rank = useAsyncData(rankFetcher, `leaderboard:user:${keyId}`)

  if (!keyId) return <EmptyState title="No user specified" />
  if (rank.status === "loading") return <ProfileSkeleton />
  if (rank.status === "success" && rank.data.handle) {
    return <Navigate to={`/u/${rank.data.handle}`} replace />
  }
  return <UserProfileView keyId={keyId} />
}
