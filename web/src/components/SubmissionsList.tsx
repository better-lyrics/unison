import { useCallback, useEffect, useMemo, useState } from "react"
import { EmptyState } from "@/components/EmptyState"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserSubmissions } from "@/lib/api"
import { formatRelativeTime, formatVotes } from "@/lib/format"
import type { UserSubmission } from "@/lib/types"

interface SubmissionsListProps {
  keyId: string
}

interface PageState {
  keyId: string
  extra: UserSubmission[]
  cursor: string | undefined
  cursorInitialized: boolean
  loadingMore: boolean
  loadMoreError: string | null
}

type SyncFilter = "all" | "richsync" | "linesync" | "plain"
type SortMode = "newest" | "oldest" | "most_votes" | "least_votes"

interface ToolbarState {
  search: string
  syncType: SyncFilter
  sort: SortMode
}

const DEFAULT_TOOLBAR: ToolbarState = { search: "", syncType: "all", sort: "newest" }

function emptyState(keyId: string): PageState {
  return {
    keyId,
    extra: [],
    cursor: undefined,
    cursorInitialized: false,
    loadingMore: false,
    loadMoreError: null,
  }
}

export function SubmissionsList({ keyId }: SubmissionsListProps) {
  const firstPageFetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const firstPage = useAsyncData(firstPageFetcher, `user:submissions:${keyId}`)
  const [page, setPage] = useState<PageState>(() => emptyState(keyId))
  const [toolbar, setToolbar] = useState<ToolbarState>(DEFAULT_TOOLBAR)

  useEffect(() => {
    setPage(emptyState(keyId))
    setToolbar(DEFAULT_TOOLBAR)
  }, [keyId])

  useEffect(() => {
    if (firstPage.status !== "success") return
    setPage((prev) => {
      if (prev.keyId !== keyId || prev.cursorInitialized) return prev
      return { ...prev, cursor: firstPage.data.nextCursor, cursorInitialized: true }
    })
  }, [firstPage, keyId])

  const sameKey = page.keyId === keyId
  const all = useMemo<UserSubmission[]>(() => {
    if (firstPage.status !== "success") return []
    return [...firstPage.data.submissions, ...(sameKey ? page.extra : [])]
  }, [firstPage, page.extra, sameKey])

  const visible = useMemo(() => {
    const needle = toolbar.search.trim().toLowerCase()
    const filtered = all.filter((s) => {
      if (toolbar.syncType !== "all" && s.syncType !== toolbar.syncType) return false
      if (needle.length === 0) return true
      return `${s.song} ${s.artist}`.toLowerCase().includes(needle)
    })
    return [...filtered].sort((a, b) => {
      switch (toolbar.sort) {
        case "newest":
          return b.createdAt - a.createdAt
        case "oldest":
          return a.createdAt - b.createdAt
        case "most_votes":
          return b.voteCount - a.voteCount
        case "least_votes":
          return a.voteCount - b.voteCount
      }
    })
  }, [all, toolbar])

  if (firstPage.status === "loading") return null
  if (firstPage.status === "error") {
    return <EmptyState title="Could not load submissions" hint={firstPage.error.message} />
  }

  if (all.length === 0) {
    return <EmptyState title="No submissions yet" />
  }

  const cursor = sameKey && page.cursorInitialized ? page.cursor : firstPage.data.nextCursor

  const loadMore = async () => {
    if (cursor === undefined || page.loadingMore) return
    setPage((prev) => ({ ...prev, loadingMore: true, loadMoreError: null }))
    try {
      const next = await fetchUserSubmissions(keyId, cursor)
      setPage((prev) =>
        prev.keyId === keyId
          ? {
              ...prev,
              extra: [...prev.extra, ...next.submissions],
              cursor: next.nextCursor,
              loadingMore: false,
              loadMoreError: null,
            }
          : prev,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load more"
      setPage((prev) =>
        prev.keyId === keyId ? { ...prev, loadingMore: false, loadMoreError: message } : prev,
      )
    }
  }

  const inputClass =
    "rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-sm text-unison-text transition-colors hover:bg-unison-bg-hover focus:border-unison-border-strong focus:outline-none"

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-unison-text">Submissions</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={toolbar.search}
          onChange={(e) => setToolbar((t) => ({ ...t, search: e.target.value }))}
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
          onChange={(e) => setToolbar((t) => ({ ...t, sort: e.target.value as SortMode }))}
          aria-label="Sort submissions"
          className={`${inputClass} cursor-pointer`}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="most_votes">Most votes</option>
          <option value="least_votes">Least votes</option>
        </select>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-unison-text-muted">
          No matches in loaded submissions. Try clearing filters or loading more.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id}>
              <a
                href={`https://music.youtube.com/watch?v=${s.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3 transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover"
              >
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
                <p className="shrink-0 font-mono text-xs text-unison-text-muted">{formatVotes(s.voteCount)} votes</p>
              </a>
            </li>
          ))}
        </ul>
      )}
      {cursor !== undefined ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={page.loadingMore}
            className="cursor-pointer rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-xs text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text disabled:opacity-50"
          >
            {page.loadingMore ? "Loading..." : page.loadMoreError ? "Retry" : "Load more"}
          </button>
          {page.loadMoreError ? (
            <p role="alert" className="text-xs text-unison-text-muted">
              {page.loadMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
