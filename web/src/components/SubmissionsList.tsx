import { uniqueById } from "@/lib/unique-by-id"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { EmptyState } from "@/components/EmptyState"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { fetchUserSubmissions } from "@/lib/api"
import { formatCompact, formatExact, formatRelativeTime } from "@/lib/format"
import type { SubmissionSort, SubmissionSyncType } from "@/lib/types"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

interface SubmissionsListProps {
  keyId: string
}

type SyncFilter = "all" | SubmissionSyncType

interface ToolbarState {
  search: string
  syncType: SyncFilter
  sort: SubmissionSort
}

const DEFAULT_TOOLBAR: ToolbarState = { search: "", syncType: "all", sort: "newest" }
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_MAX_LENGTH = 100

export function SubmissionsList({ keyId }: SubmissionsListProps) {
  return <CuratorSubmissions key={keyId} keyId={keyId} />
}

function CuratorSubmissions({ keyId }: SubmissionsListProps) {
  const [toolbar, setToolbar] = useState<ToolbarState>(DEFAULT_TOOLBAR)

  const typedSearch = toolbar.search.trim()
  const debouncedSearch = useDebouncedValue(typedSearch, typedSearch.length === 0 ? 0 : SEARCH_DEBOUNCE_MS)
  const search = typedSearch.length === 0 ? "" : debouncedSearch
  const syncType = toolbar.syncType === "all" ? undefined : toolbar.syncType
  const { sort } = toolbar
  const filtered = search.length > 0 || syncType !== undefined
  const toolbarChanged = filtered || sort !== DEFAULT_TOOLBAR.sort

  const {
    data,
    status,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isPlaceholderData,
  } = useInfiniteQuery({
    queryKey: ["user", keyId, "submissions", { search, syncType, sort }],
    queryFn: ({ pageParam }) => fetchUserSubmissions(keyId, { search, syncType, sort, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const visible = useMemo(() => {
    return uniqueById(data?.pages.flatMap((page) => page.submissions) ?? [])
  }, [data])

  if (status === "pending") {
    return (
      <CollapsibleSection title="Submissions">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Bone className="h-9 min-w-0 flex-1" />
            <Bone className="h-9 w-32" />
            <Bone className="h-9 w-32" />
          </div>
          <ul className="border-b border-unison-border">
            {skeletonKeys("submission-skeleton", 4).map((key) => (
              <li key={key} className="flex items-center gap-3 border-t border-unison-border px-2 py-3.5">
                <Bone className="size-11 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Bone className="h-3.5 w-1/2" />
                  <Bone className="h-3 w-2/3" />
                </div>
                <Bone className="h-3 w-14 shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleSection>
    )
  }
  const listError = status === "error" && !isFetchNextPageError ? error.message : null
  if (listError !== null && !toolbarChanged) {
    return <EmptyState title="Could not load submissions" hint={listError} />
  }

  if (visible.length === 0 && !filtered && !isPlaceholderData && listError === null) {
    return <EmptyState title="No submissions yet" />
  }

  const loadMoreError = isFetchNextPageError ? (error?.message ?? "Could not load more") : null

  const inputClass =
    "rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover focus:border-unison-border-strong focus:outline-none"

  return (
    <CollapsibleSection title="Submissions">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={toolbar.search}
            onChange={(e) => setToolbar((t) => ({ ...t, search: e.target.value }))}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="Search song or artist"
            aria-label="Search submissions"
            className={`${inputClass} min-w-0 flex-1 placeholder:text-unison-text-muted`}
          />
          <select
            value={toolbar.syncType}
            onChange={(e) => setToolbar((t) => ({ ...t, syncType: e.target.value as SyncFilter }))}
            aria-label="Filter by sync type"
            className={`${inputClass} cursor-pointer`}
          >
            <option value="all">All sync types</option>
            <option value="richsync">Richsync</option>
            <option value="linesync">Linesync</option>
            <option value="plain">Plain</option>
          </select>
          <select
            value={toolbar.sort}
            onChange={(e) => setToolbar((t) => ({ ...t, sort: e.target.value as SubmissionSort }))}
            aria-label="Sort submissions"
            className={`${inputClass} cursor-pointer`}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="most_votes">Most votes</option>
            <option value="least_votes">Least votes</option>
          </select>
        </div>
        {listError !== null ? (
          <p role="alert" className="text-xs text-unison-text-muted">
            Could not load submissions. {listError}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-unison-text-muted">No submissions match these filters.</p>
        ) : (
          <ul className="border-b border-unison-border">
            {visible.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/song/${s.videoId}`}
                  className="flex items-center gap-3 border-t border-unison-border px-2 py-3.5 transition-colors hover:bg-unison-bg-hover"
                >
                  <SongThumbnail videoId={s.videoId} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-unison-text">
                      <span className="truncate">{s.song}</span>
                      {s.hidden ? (
                        <span className="shrink-0 rounded bg-unison-bg-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-unison-text-secondary">
                          hidden
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-unison-text-muted">
                      {s.artist} · {s.syncType} · {formatRelativeTime(s.createdAt)}
                    </p>
                  </div>
                  <p
                    title={`${formatExact(s.voteCount)} votes`}
                    className="shrink-0 font-mono text-xs text-unison-text-muted"
                  >
                    {formatCompact(s.voteCount)} votes
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasNextPage && !isPlaceholderData ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="cursor-pointer rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-xs text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading..." : loadMoreError ? "Retry" : "Load more"}
            </button>
            {loadMoreError ? (
              <p role="alert" className="text-xs text-unison-text-muted">
                {loadMoreError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  )
}
