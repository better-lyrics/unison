import { useQuery } from "@tanstack/react-query"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { COVER_GRID, SongCoverTile, SongCoverTileSkeletons } from "@/components/SongCoverTile"
import { type FeedGridSort, fetchFeedGrid } from "@/lib/api"

const GRID_LIMIT = 8

interface FeedGridProps {
  sort: FeedGridSort
  title: string
  subtitle: string
}

export function FeedGrid({ sort, title, subtitle }: FeedGridProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["feed-grid", sort],
    queryFn: ({ signal }) => fetchFeedGrid({ sort, limit: GRID_LIMIT, signal }),
    staleTime: 5 * 60_000,
  })

  if (!isPending && (isError || data.items.length === 0)) return null

  return (
    <LeaderboardSection title={title} subtitle={subtitle}>
      {isPending ? (
        <SongCoverTileSkeletons id={`feed-grid-${sort}`} count={GRID_LIMIT} />
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
