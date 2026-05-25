import { useCallback, useEffect } from "react"
import { useSession } from "@/auth/useSession"
import { CuratorRow } from "@/components/CuratorRow"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchCuratorLeaderboard, fetchUserRank } from "@/lib/api"
import type { CuratorLeaderboardEntry, UserRankResponse } from "@/lib/types"

const NOT_RANKED: UserRankResponse = {
  ranked: false,
  keyId: "",
  displayName: "",
  lastVoteAt: null,
}

export function CuratorsPage() {
  const session = useSession()
  const { status, data, error } = useAsyncData(fetchCuratorLeaderboard, "leaderboard:curators")
  const selfKeyId = session.status === "signed-in" ? session.identity.keyId : null

  const myRankFetcher = useCallback(() => {
    if (!selfKeyId) return Promise.resolve(NOT_RANKED)
    return fetchUserRank(selfKeyId)
  }, [selfKeyId])
  const myRank = useAsyncData(myRankFetcher, selfKeyId ? `leaderboard:user:${selfKeyId}` : undefined)

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
    const { ranked: _ranked, lastVoteAt: _lastVoteAt, ...entry } = myRank.data
    if (top.some((c) => c.keyId === entry.keyId)) {
      return { list: top, appendedKeyId: null }
    }
    return { list: [...top, entry], appendedKeyId: entry.keyId }
  })()

  const signedIn = session.status === "signed-in"
  const showNotRankedHint = signedIn && myRank.status === "success" && !myRank.data.ranked && merged.list.length > 0

  return (
    <LeaderboardSection title="Curators" subtitle="Ranked by total reputation-weighted contribution score">
      {merged.list.length === 0 ? (
        signedIn ? (
          <EmptyState title="No curators yet" hint="Be the first by submitting lyrics from Better Lyrics." />
        ) : (
          <EmptyState title="No curators yet" />
        )
      ) : (
        <>
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
          {showNotRankedHint ? (
            <p className="mt-4 text-xs text-unison-text-muted">
              You haven't ranked yet. Open YT Music with Better Lyrics installed and submit some lyrics to climb in.
            </p>
          ) : null}
        </>
      )}
    </LeaderboardSection>
  )
}
