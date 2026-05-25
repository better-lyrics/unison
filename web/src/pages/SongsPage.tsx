import { useSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { SongRow } from "@/components/SongRow"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchSongLeaderboard } from "@/lib/api"

export function SongsPage() {
  const session = useSession()
  const signedIn = session.status === "signed-in"
  const { status, data, error } = useAsyncData(fetchSongLeaderboard, "leaderboard:songs")

  if (status === "loading") {
    return (
      <div className="space-y-8">
        <LeaderboardSection title="Most Wanted">
          <LoadingPlaceholder />
        </LeaderboardSection>
        <LeaderboardSection title="Needs Fixing">
          <LoadingPlaceholder rows={3} />
        </LeaderboardSection>
      </div>
    )
  }

  if (status === "error") {
    return <EmptyState title="Could not load leaderboard" hint={error.message} />
  }

  return (
    <div className="space-y-8">
      <LeaderboardSection
        title="Most Wanted"
        subtitle="Songs missing synced lyrics, ranked by reputation-weighted demand"
      >
        {data.mostWanted.length === 0 ? (
          signedIn ? (
            <EmptyState
              title="Nothing requested right now"
              hint="Request lyrics from Better Lyrics on a YT Music song you want covered."
            />
          ) : (
            <EmptyState title="Nothing wanted right now" hint="Request a song from the extension to seed the board." />
          )
        ) : (
          <ul className="space-y-2">
            {data.mostWanted.map((entry) => (
              <SongRow key={entry.videoId} entry={entry} />
            ))}
          </ul>
        )}
      </LeaderboardSection>

      <LeaderboardSection
        title="Needs Fixing"
        subtitle="Songs with synced lyrics but enough bad-sync reports to investigate"
      >
        {data.needsFixing.length === 0 ? (
          signedIn ? (
            <EmptyState
              title="Nothing flagged"
              hint="Notice a song with bad lyric sync? Report it from Better Lyrics."
            />
          ) : (
            <EmptyState title="Nothing flagged" hint="Reports below the threshold do not show up here." />
          )
        ) : (
          <ul className="space-y-2">
            {data.needsFixing.map((entry) => (
              <SongRow key={entry.videoId} entry={entry} />
            ))}
          </ul>
        )}
      </LeaderboardSection>
    </div>
  )
}
