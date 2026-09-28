import { useSession } from "@/auth/useSession"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection, SeeAllLink } from "@/components/LeaderboardSection"
import { SealedShelf } from "@/components/SealedShelf"
import { SongRow, SongRowSkeletonList } from "@/components/SongRow"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchSongLeaderboard } from "@/lib/api"

const MOST_WANTED_PREVIEW = 10

const mostWantedAction = <SeeAllLink to="/queue" label="See all most wanted songs" />

export function SongsPage() {
  const session = useSession()
  const signedIn = session.status === "signed-in"
  const { status, data, error } = useAsyncData(fetchSongLeaderboard, "leaderboard:songs")

  if (status === "loading") {
    return (
      <div className="space-y-8">
        <SealedShelf />
        <LeaderboardSection title="Most Wanted">
          <SongRowSkeletonList rows={5} />
        </LeaderboardSection>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="space-y-8">
        <SealedShelf />
        <EmptyState title="Could not load leaderboard" hint={error.message} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SealedShelf />
      <LeaderboardSection
        title="Most Wanted"
        subtitle="Songs missing synced lyrics, ranked by reputation-weighted demand"
        action={mostWantedAction}
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
            {data.mostWanted.slice(0, MOST_WANTED_PREVIEW).map((entry) => (
              <SongRow key={entry.videoId} entry={entry} />
            ))}
          </ul>
        )}
      </LeaderboardSection>
    </div>
  )
}
