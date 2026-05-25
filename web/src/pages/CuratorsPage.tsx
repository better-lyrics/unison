import { useCallback, useEffect } from "react"
import { useSession } from "@/auth/useSession"
import { CuratorRow } from "@/components/CuratorRow"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchCuratorLeaderboard, fetchMyCuratorRank } from "@/lib/api"
import type { CuratorLeaderboardEntry, MyCuratorRankResponse } from "@/lib/types"

const NOT_RANKED: MyCuratorRankResponse = { ranked: false }

export function CuratorsPage() {
  const session = useSession()
  const { status, data, error } = useAsyncData(fetchCuratorLeaderboard)
  const selfKeyId = session.status === "signed-in" ? session.identity.keyId : null

  const myRankFetcher = useCallback(() => {
    if (!selfKeyId) return Promise.resolve(NOT_RANKED)
    return fetchMyCuratorRank(selfKeyId)
  }, [selfKeyId])
  const myRank = useAsyncData(myRankFetcher)

  useEffect(() => {
    if (myRank.status === "error") {
      console.error("failed to fetch own curator rank", myRank.error)
    }
  }, [myRank.status, myRank.error])

  if (status === "loading" || (selfKeyId !== null && myRank.status === "loading")) {
    return (
      <LeaderboardSection title="Curators">
        <LoadingPlaceholder />
      </LeaderboardSection>
    )
  }

  if (status === "error") {
    return <EmptyState title="Could not load curators" hint={error.message} />
  }

  const merged: { list: CuratorLeaderboardEntry[]; appendedKeyId: string | null } = (() => {
    const top = data.curators
    if (myRank.status !== "success" || !myRank.data.ranked) {
      return { list: top, appendedKeyId: null }
    }
    const { ranked: _ranked, ...entry } = myRank.data
    if (top.some((c) => c.keyId === entry.keyId)) {
      return { list: top, appendedKeyId: null }
    }
    return { list: [...top, entry], appendedKeyId: entry.keyId }
  })()

  return (
    <LeaderboardSection title="Curators" subtitle="Ranked by total reputation-weighted contribution score">
      {merged.list.length === 0 ? (
        <EmptyState title="No curators yet" />
      ) : (
        <ul className="space-y-2">
          {merged.list.map((entry) => (
            <CuratorRow
              key={entry.keyId}
              entry={entry}
              isSelf={selfKeyId === entry.keyId}
              appended={entry.keyId === merged.appendedKeyId}
            />
          ))}
        </ul>
      )}
    </LeaderboardSection>
  )
}
