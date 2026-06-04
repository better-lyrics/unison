import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { SearchResultRow } from "@/components/SearchResultRow"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { searchLyrics } from "@/lib/api"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200

export function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get("q") ?? ""
  const song = params.get("song") ?? undefined
  const artist = params.get("artist") ?? undefined

  const debounced = useDebouncedValue({ q, song, artist }, DEBOUNCE_MS)
  const enabled = debounced.q.trim().length >= MIN_QUERY_LENGTH || !!debounced.song || !!debounced.artist

  const { data, isLoading, error } = useQuery({
    queryKey: ["lyrics", "search", debounced],
    queryFn: ({ signal }) => searchLyrics({ ...debounced, signal }),
    enabled,
    staleTime: 60_000,
  })

  if (!enabled) {
    return <EmptyState title="Type a song, artist, or lyric line." />
  }

  if (isLoading) {
    return <LoadingPlaceholder rows={6} />
  }

  if (error) {
    return <EmptyState title="Could not load results" hint={error.message} />
  }

  if (!data || data.results.length === 0) {
    return <EmptyState title="No matches" hint="Try the lyric text directly." />
  }

  return (
    <ul className="space-y-2">
      {data.results.map((entry, index) => (
        <SearchResultRow key={entry.id} entry={entry} rank={index + 1} />
      ))}
    </ul>
  )
}
