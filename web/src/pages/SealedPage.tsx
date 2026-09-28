import { useInfiniteQuery } from "@tanstack/react-query"
import { MotionConfig, motion } from "motion/react"
import { useMemo, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { SYNC_LABEL, SealedTile, SealedTileSkeleton } from "@/components/SealedTile"
import { Segmented } from "@/components/council/Segmented"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { buttonClass } from "@/components/ui"
import { fetchSealed } from "@/lib/api"
import { cn } from "@/lib/cn"
import { EASE_OUT, thudFrom, thudTransition } from "@/lib/motion-variants"
import type { SealedSort, SealedSyncFilter } from "@/lib/types"
import { uniqueById } from "@/lib/unique-by-id"

const PAGE_LIMIT = 24
const SUBMIT_TUTORIAL_URL = "https://www.youtube.com/watch?v=to138zXZ0nc"
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"
const HERO_SEAL_AT = 0.1
const HERO_TEXT_AT = 0.3
const HERO_ACTION_AT = 0.45
const CARDS_AFTER_HERO = 0.6
const heroSeal = thudFrom(2.6)
const heroAction = thudFrom(1.25, 0.06)

type SyncChoice = SealedSyncFilter | "all"

const SYNC_OPTIONS: { value: SyncChoice; label: string }[] = [
  { value: "all", label: "All" },
  { value: "richsync", label: SYNC_LABEL.richsync },
  { value: "linesync", label: SYNC_LABEL.linesync },
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

  const entries = useMemo(() => uniqueById(data?.pages.flatMap((page) => page.items) ?? []), [data])
  const mountedAt = useRef(performance.now())
  const cardsDelay = Math.max(0, CARDS_AFTER_HERO - (performance.now() - mountedAt.current) / 1000)

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6">
        <section
          className="flex flex-col gap-5 rounded-xl p-6 sm:flex-row sm:items-center"
          style={{ background: "linear-gradient(135deg, rgba(217,217,217,0.1), rgba(255,255,255,0.02) 55%)" }}
        >
          <motion.img
            src="/badges/committee/image.svg"
            alt=""
            className="size-16 shrink-0"
            style={{ rotate: -6 }}
            {...heroSeal}
            transition={thudTransition(HERO_SEAL_AT)}
          />
          <motion.div
            className="min-w-0 flex-1"
            initial={{ opacity: 0, x: -8, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.42, delay: HERO_TEXT_AT, ease: EASE_OUT }}
          >
            <h1 className="text-[22px] font-bold tracking-tight text-unison-text">Sealed lyrics</h1>
            <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-unison-text-secondary">
              Each of these got the BLCA seal from a Council member. Want yours sealed? Open a few and see how they are
              timed.
            </p>
          </motion.div>
          <motion.div className="shrink-0" {...heroAction} transition={thudTransition(HERO_ACTION_AT)}>
            <a
              href={SUBMIT_TUTORIAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonClass("primary", "sm"), "w-full")}
            >
              How to submit
            </a>
          </motion.div>
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
              {entries.map((entry, index) => (
                <li key={entry.id}>
                  <SealedTile
                    entry={entry}
                    variant="card"
                    enterIndex={index % PAGE_LIMIT}
                    enterDelay={index < PAGE_LIMIT ? cardsDelay : 0}
                  />
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
    </MotionConfig>
  )
}
