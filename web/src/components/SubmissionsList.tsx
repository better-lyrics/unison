import { useCallback, useEffect, useState } from "react"
import { EmptyState } from "@/components/EmptyState"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchUserSubmissions } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type { UserSubmission } from "@/lib/types"

interface SubmissionsListProps {
  keyId: string
}

interface PageState {
  keyId: string
  extra: UserSubmission[]
  cursor: number | undefined
  cursorInitialized: boolean
  loadingMore: boolean
}

function emptyState(keyId: string): PageState {
  return { keyId, extra: [], cursor: undefined, cursorInitialized: false, loadingMore: false }
}

export function SubmissionsList({ keyId }: SubmissionsListProps) {
  const firstPageFetcher = useCallback(() => fetchUserSubmissions(keyId), [keyId])
  const firstPage = useAsyncData(firstPageFetcher, `user:submissions:${keyId}`)
  const [page, setPage] = useState<PageState>(() => emptyState(keyId))

  useEffect(() => {
    setPage(emptyState(keyId))
  }, [keyId])

  useEffect(() => {
    if (firstPage.status !== "success") return
    setPage((prev) => {
      if (prev.keyId !== keyId || prev.cursorInitialized) return prev
      return { ...prev, cursor: firstPage.data.nextCursor, cursorInitialized: true }
    })
  }, [firstPage, keyId])

  if (firstPage.status === "loading") return null
  if (firstPage.status === "error") {
    return <EmptyState title="Could not load submissions" hint={firstPage.error.message} />
  }

  const sameKey = page.keyId === keyId
  const all = [...firstPage.data.submissions, ...(sameKey ? page.extra : [])]
  if (all.length === 0) {
    return <EmptyState title="No submissions yet" />
  }

  const cursor = sameKey && page.cursorInitialized ? page.cursor : firstPage.data.nextCursor

  const loadMore = async () => {
    if (cursor === undefined || page.loadingMore) return
    setPage((prev) => ({ ...prev, loadingMore: true }))
    try {
      const next = await fetchUserSubmissions(keyId, cursor)
      setPage((prev) =>
        prev.keyId === keyId
          ? {
              ...prev,
              extra: [...prev.extra, ...next.submissions],
              cursor: next.nextCursor,
              loadingMore: false,
            }
          : prev,
      )
    } catch (err) {
      setPage((prev) => ({ ...prev, loadingMore: false }))
      throw err
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-unison-text">Submissions</h3>
      <ul className="space-y-2">
        {all.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-unison-border bg-unison-bg-elevated px-4 py-3"
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
            <p className="shrink-0 font-mono text-xs text-unison-text-muted">{s.voteCount} votes</p>
          </li>
        ))}
      </ul>
      {cursor !== undefined ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={page.loadingMore}
          className="cursor-pointer rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-xs text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text disabled:opacity-50"
        >
          {page.loadingMore ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </div>
  )
}
