import { useSession } from "@/auth/useSession"
import { CuratorRow } from "@/components/CuratorRow"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchCuratorLeaderboard } from "@/lib/api"

export function CuratorsPage() {
  const session = useSession()
  const { status, data, error } = useAsyncData(fetchCuratorLeaderboard)
  const selfKeyId = session.status === "signed-in" ? session.identity.keyId : null

  if (status === "loading") {
    return (
      <LeaderboardSection title="Curators">
        <LoadingPlaceholder />
      </LeaderboardSection>
    )
  }

  if (status === "error") {
    return <EmptyState title="Could not load curators" hint={error.message} />
  }

  return (
    <LeaderboardSection title="Curators" subtitle="Ranked by total reputation-weighted contribution score">
      {data.curators.length === 0 ? (
        <EmptyState title="No curators yet" />
      ) : (
        <ul className="space-y-2">
          {data.curators.map((entry) => (
            <CuratorRow key={entry.keyId} entry={entry} isSelf={selfKeyId === entry.keyId} />
          ))}
        </ul>
      )}
    </LeaderboardSection>
  )
}
