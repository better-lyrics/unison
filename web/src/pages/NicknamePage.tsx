import { useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { ProfileSkeleton } from "@/components/ProfileSkeleton"
import { UserProfileView } from "@/components/UserProfileView"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchCuratorLeaderboard } from "@/lib/api"
import { toHandle } from "@/lib/handle"

// Resolves a /u/<handle> share URL to a profile by matching the handle against ranked curators.
// A dedicated backend nickname lookup would cover curators outside the leaderboard page too.
export function NicknamePage() {
  const { nickname } = useParams<{ nickname: string }>()
  const board = useAsyncData(fetchCuratorLeaderboard, "leaderboard:curators")

  if (!nickname) return <EmptyState title="No curator specified" />
  if (board.status === "loading") return <ProfileSkeleton />
  if (board.status === "error") return <EmptyState title="Could not load profile" hint={board.error.message} />

  const wanted = toHandle(nickname)
  const match = board.data.curators.find((c) => toHandle(c.displayName) === wanted)
  if (!match) {
    return <EmptyState title="No curator found" hint={`No curator matches @${wanted}.`} />
  }
  return <UserProfileView keyId={match.keyId} />
}
