import { uniqueById } from "@/lib/unique-by-id"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { EmptyState } from "@/components/EmptyState"
import { SectionHeading } from "@/components/profile/SectionHeading"
import { Bone } from "@/components/skeleton"
import { COVER_GRID, SongCoverTile, SongCoverTileSkeletons } from "@/components/SongCoverTile"
import { glassClass } from "@/components/ui"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { fetchUserSubmissions } from "@/lib/api"
import { cn } from "@/lib/cn"
import { COMPOSER_URL } from "@/lib/composer"
import { formatExact } from "@/lib/format"
import type { SubmissionSort, SubmissionSyncType } from "@/lib/types"
import { motion } from "motion/react"
import { type ReactNode, useMemo, useState } from "react"
import { SwapLabel } from "@/components/SwapLabel"
import { LAYOUT_TRANSITION } from "@/lib/motion-variants"

interface SubmissionsListProps {
  keyId: string
  total?: number
  owner?: boolean
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

const TITLE = "Songs synced"
const FIELD = cn(glassClass, "h-10 rounded-xl text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-white/30")

export function SubmissionsList(props: SubmissionsListProps) {
  return <CuratorSubmissions key={props.keyId} {...props} />
}

function Section({ meta, children }: { meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title={TITLE} meta={meta} />
      {children}
    </section>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <span className="relative inline-flex [text-shadow:none]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(FIELD, "cursor-pointer appearance-none pr-9 pl-3.5 text-(--ink-2)")}
      >
        {children}
      </select>
      <IconChevronDown
        aria-hidden
        stroke={1.75}
        className="pointer-events-none absolute top-1/2 right-3 size-[15px] -translate-y-1/2 text-(--ink-3)"
      />
    </span>
  )
}

function CuratorSubmissions({ keyId, total, owner = false }: SubmissionsListProps) {
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
      <Section>
        <div className="flex flex-wrap gap-2">
          <Bone className="h-10 min-w-[200px] flex-1 rounded-xl" />
          <Bone className="h-10 w-36 rounded-xl" />
          <Bone className="h-10 w-32 rounded-xl" />
        </div>
        <SongCoverTileSkeletons id="submission-skeleton" count={4} />
      </Section>
    )
  }
  const listError = status === "error" && !isFetchNextPageError ? error.message : null
  if (listError !== null && !toolbarChanged) {
    return (
      <Section>
        <EmptyState title="Could not load submissions" hint={listError} />
      </Section>
    )
  }

  if (visible.length === 0 && !filtered && !isPlaceholderData && listError === null) {
    return (
      <Section>
        <EmptyState title="No songs synced yet" hint="Synced songs show up here, with their covers.">
          {owner ? (
            <a
              href={COMPOSER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-unison-text pr-[18px] pl-4 text-sm font-bold text-[#121116] transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] hover:bg-white"
            >
              <IconPlus className="size-[17px]" stroke={2} />
              Sync a song
            </a>
          ) : null}
        </EmptyState>
      </Section>
    )
  }

  const loadMoreError = isFetchNextPageError ? (error?.message ?? "Could not load more") : null

  return (
    <Section meta={total ? `${formatExact(total)} total` : undefined}>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={toolbar.search}
          onChange={(e) => setToolbar((t) => ({ ...t, search: e.target.value }))}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Search song or artist"
          aria-label="Search submissions"
          className={cn(FIELD, "min-w-[200px] flex-1 px-3.5 text-sm text-unison-text placeholder:text-(--ink-3)")}
        />
        <SelectField
          label="Filter by sync type"
          value={toolbar.syncType}
          onChange={(value) => setToolbar((t) => ({ ...t, syncType: value as SyncFilter }))}
        >
          <option value="all">All sync types</option>
          <option value="richsync">Richsync</option>
          <option value="linesync">Linesync</option>
          <option value="plain">Plain</option>
        </SelectField>
        <SelectField
          label="Sort submissions"
          value={toolbar.sort}
          onChange={(value) => setToolbar((t) => ({ ...t, sort: value as SubmissionSort }))}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="most_votes">Most votes</option>
          <option value="least_votes">Least votes</option>
        </SelectField>
      </div>
      {listError !== null ? (
        <p role="alert" className="text-[13px] text-(--ink-3)">
          Could not load submissions. {listError}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-[13px] text-(--ink-3)">No submissions match these filters.</p>
      ) : (
        <ul className={cn(COVER_GRID, "t-reveal", isPlaceholderData && "opacity-60")}>
          {visible.map((s) => (
            <SongCoverTile key={s.id} song={s} />
          ))}
        </ul>
      )}
      {hasNextPage && !isPlaceholderData ? (
        <div className="flex flex-col items-start gap-2">
          <motion.button
            layout
            transition={{ layout: LAYOUT_TRANSITION }}
            style={{ borderRadius: 9999 }}
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className={cn(
              glassClass,
              "h-10 cursor-pointer rounded-full px-4 text-[13px] font-medium transition-[background-color,scale] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:opacity-50 [text-shadow:none] hover:bg-white/[0.14]",
            )}
          >
            <SwapLabel text={isFetchingNextPage ? "Loading…" : loadMoreError ? "Retry" : "Load more"} />
          </motion.button>
          {loadMoreError ? (
            <p role="alert" className="text-xs text-(--ink-3)">
              {loadMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}
