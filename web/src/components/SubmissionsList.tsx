import { uniqueById } from "@/lib/unique-by-id"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { EmptyState } from "@/components/EmptyState"
import { SectionHeading } from "@/components/profile/SectionHeading"
import { Bone, skeletonKeys } from "@/components/skeleton"
import { SongThumbnail } from "@/components/SongThumbnail"
import { glassClass } from "@/components/ui"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { fetchUserSubmissions } from "@/lib/api"
import { cn } from "@/lib/cn"
import { COMPOSER_URL } from "@/lib/composer"
import { formatCompact, formatExact, formatRelativeTime } from "@/lib/format"
import type { SubmissionSort, SubmissionSyncType, UserSubmission } from "@/lib/types"
import { type ReactNode, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { syncTypeFor } from "@/lib/sync-type"
import { SyncTag } from "@/components/SyncTag"

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
const GRID = "grid grid-cols-4 gap-5 max-[1000px]:grid-cols-2 max-[1000px]:gap-4"
const OVERHANG = "-mr-[0.08em] -mb-[0.16em] pr-[0.08em] pb-[0.16em]"
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

function SongTile({ submission: s }: { submission: UserSubmission }) {
  return (
    <li className="min-w-0">
      <Link to={`/song/${s.videoId}`} className="flex min-w-0 flex-col gap-2.5 rounded-xl">
        <SongThumbnail
          videoId={s.videoId}
          song={s.song}
          artist={s.artist}
          className="relative aspect-square w-full rounded-xl bg-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.3)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:outline after:outline-1 after:-outline-offset-1 after:outline-white/10"
        />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
            <span title={s.song} className={cn("truncate", OVERHANG)}>
              {s.song}
            </span>
            {s.hidden ? (
              <span className="shrink-0 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-(--ink-2) [text-shadow:none]">
                hidden
              </span>
            ) : null}
          </p>
          <p title={s.artist} className={cn("mt-0.5 truncate text-xs text-(--ink-3)", OVERHANG)}>
            {s.artist}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-(--ink-dim) [text-shadow:none]">
            <SyncTag kind={syncTypeFor(s.syncType, s.format)} />
            <span className="truncate">{formatRelativeTime(s.createdAt)}</span>
            <span title={`${formatExact(s.voteCount)} votes`} className="ml-auto whitespace-nowrap font-mono text-[11px]">
              {formatCompact(s.voteCount)} {s.voteCount === 1 ? "vote" : "votes"}
            </span>
          </div>
        </div>
      </Link>
    </li>
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
        <ul className={GRID}>
          {skeletonKeys("submission-skeleton", 4).map((key) => (
            <li key={key} className="flex flex-col gap-2.5">
              <Bone className="aspect-square w-full rounded-xl" />
              <Bone className="h-3.5 w-2/3" />
              <Bone className="h-3 w-1/2" />
            </li>
          ))}
        </ul>
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
        <ul className={GRID}>
          {visible.map((s) => (
            <SongTile key={s.id} submission={s} />
          ))}
        </ul>
      )}
      {hasNextPage && !isPlaceholderData ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className={cn(
              glassClass,
              "h-10 cursor-pointer rounded-full px-4 text-[13px] font-medium transition-[background-color,scale] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:opacity-50 [text-shadow:none] hover:bg-white/[0.14]",
            )}
          >
            {isFetchingNextPage ? "Loading..." : loadMoreError ? "Retry" : "Load more"}
          </button>
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
