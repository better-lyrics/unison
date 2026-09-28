import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { SealedTile, SealedTileSkeleton } from "@/components/SealedTile"
import { Segmented } from "@/components/council/Segmented"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { fetchSealed } from "@/lib/api"
import type { SealedSort, SealedSyncFilter } from "@/lib/types"

const PAGE_LIMIT = 24
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"

type SyncChoice = SealedSyncFilter | "all"

const SYNC_OPTIONS: { value: SyncChoice; label: string }[] = [
  { value: "all", label: "All" },
  { value: "richsync", label: "Word synced" },
  { value: "linesync", label: "Line synced" },
]

const SORT_OPTIONS: { value: SealedSort; label: string }[] = [
  { value: "recently-sealed", label: "Recently sealed" },
  { value: "top-rated", label: "Top rated" },
]

function readSync(value: string | null): SyncChoice {
  return value === "richsync" || value === "linesync" ? value : "all"
}

function readSort(value: string | null): SealedSort {
  return value === "top-rated" ? "top-rated" : "recently-sealed"
}

export function SealedPage() {
  const [params, setParams] = useSearchParams()
  const sync = readSync(params.get("sync"))
  const sort = readSort(params.get("sort"))

  const setParam = (key: "sync" | "sort", value: string, fallback: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["sealed", "page", sort, sync],
    queryFn: ({ pageParam, signal }) =>
      fetchSealed({
        sort,
        syncType: sync === "all" ? undefined : sync,
        cursor: pageParam,
        limit: PAGE_LIMIT,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  const entries = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  return (
    <div className="space-y-6">
      <section
        className="flex flex-col gap-5 rounded-xl p-6 sm:flex-row sm:items-center"
        style={{ background: "linear-gradient(135deg, rgba(217,217,217,0.1), rgba(255,255,255,0.02) 55%)" }}
      >
        <img src="/badges/committee/image.svg" alt="" className="size-16 shrink-0 -rotate-6" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold tracking-tight text-unison-text">Sealed lyrics</h1>
          <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-unison-text-secondary">
            Each of these got the BLCA seal from a Council member. Want yours sealed? Open a few and see how they are
            timed.
          </p>
        </div>
        <Link to="/docs" className={buttonClass("primary", "sm")}>
          How to submit
        </Link>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Sync type"
          value={sync}
          options={SYNC_OPTIONS}
          onChange={(value) => setParam("sync", value, "all")}
        />
        <Segmented
          label="Sort"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(value) => setParam("sort", value, "recently-sealed")}
        />
        <div className="ml-auto font-mono text-xs text-unison-text-muted tabular-nums">
          {isPending ? <Bone className="h-3 w-16" /> : `${entries.length}${hasNextPage ? "+" : ""} sealed`}
        </div>
      </div>

      {isPending ? (
        <div data-testid="sealed-grid" className={GRID}>
          {skeletonKeys("sealed-card", 10).map((key) => (
            <SealedTileSkeleton key={key} variant="card" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Could not load sealed lyrics" hint={error.message} />
      ) : entries.length === 0 ? (
        <EmptyState title="Nothing sealed yet" hint="Council seals show up here as soon as they land." />
      ) : (
        <>
          <ul data-testid="sealed-grid" className={GRID}>
            {entries.map((entry) => (
              <li key={entry.id}>
                <SealedTile entry={entry} variant="card" />
              </li>
            ))}
          </ul>
          {hasNextPage ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className={buttonClass("fill", "sm")}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
