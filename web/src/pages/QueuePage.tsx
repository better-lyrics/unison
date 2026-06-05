import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { EmptyState } from "@/components/EmptyState"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { SongRow } from "@/components/SongRow"
import { fetchQueue } from "@/lib/api"
import type { QueueEntry, SongLeaderboardEntry } from "@/lib/types"

function toLeaderboardEntry(entry: QueueEntry, rank: number): SongLeaderboardEntry {
  return {
    videoId: entry.videoId,
    song: entry.song,
    artist: entry.artist,
    thumbnailUrl: entry.thumbnailUrl,
    demand: entry.demand,
    requestCount: entry.requestCount,
    section: "most_wanted",
    rank,
  }
}

interface LoadMoreButtonProps {
  onClick: () => void
  pending: boolean
}

function LoadMoreButton({ onClick, pending }: LoadMoreButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="mx-auto block rounded-md border border-unison-border bg-unison-bg-elevated px-4 py-2 text-sm transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover disabled:opacity-50"
    >
      {pending ? "Loading..." : "Load more"}
    </button>
  )
}

export function QueuePage() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["queue"],
    queryFn: ({ pageParam, signal }) => fetchQueue({ cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  })

  const entries = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: "200px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-base font-semibold text-unison-text">Queue</h1>
        <p className="text-xs text-unison-text-muted">
          All songs missing synced lyrics, ranked by reputation-weighted demand.
        </p>
      </header>

      {isLoading ? (
        <LoadingPlaceholder />
      ) : error ? (
        <EmptyState title="Could not load the queue" hint={error.message} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing in the queue right now"
          hint="Request a song via the Better Lyrics extension to seed the board."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {entries.map((entry, index) => (
              <SongRow key={entry.videoId} entry={toLeaderboardEntry(entry, index + 1)} />
            ))}
          </ul>
          <div ref={sentinelRef} aria-hidden="true" />
          {hasNextPage ? (
            <LoadMoreButton onClick={() => void fetchNextPage()} pending={isFetchingNextPage} />
          ) : (
            <p className="text-center text-xs text-unison-text-muted">You have reached the end of the queue.</p>
          )}
        </>
      )}
    </section>
  )
}
