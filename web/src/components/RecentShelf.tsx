import { useQuery } from "@tanstack/react-query"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { COVER_GRID, SongCoverTile, SongCoverTileSkeletons } from "@/components/SongCoverTile"
import { fetchRecent } from "@/lib/api"

const RECENT_LIMIT = 8

export function RecentShelf() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["recent", "shelf"],
    queryFn: ({ signal }) => fetchRecent({ limit: RECENT_LIMIT, signal }),
    staleTime: 5 * 60_000,
  })

  if (!isPending && (isError || data.items.length === 0)) return null

  return (
    <LeaderboardSection title="Recently Synced" subtitle="New lyrics the community upvoted">
      {isPending ? (
        <SongCoverTileSkeletons id="recent-shelf" count={RECENT_LIMIT} />
      ) : (
        <ul className={COVER_GRID}>
          {data.items.map((entry) => (
            <SongCoverTile key={entry.id} song={entry} />
          ))}
        </ul>
      )}
    </LeaderboardSection>
  )
}
