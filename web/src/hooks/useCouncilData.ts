import { useOptionalSession } from "@/auth/useSession"
import {
  type EventsQuery,
  fetchCouncilApplicants,
  fetchCouncilEdits,
  fetchCouncilEvents,
  fetchCouncilMembers,
  fetchCouncilMetadata,
  fetchCouncilOverview,
  fetchCouncilQueue,
  fetchSealableVariants,
} from "@/lib/council-api"
import { openItems } from "@/lib/council-triage"
import type { BookmarkView } from "@/lib/council-types"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"

export const councilKeys = {
  all: ["council"] as const,
  queue: ["council", "queue"] as const,
  sealable: (videoId: string) => ["council", "queue", "video", videoId] as const,
  edits: ["council", "edits"] as const,
  metadata: ["council", "metadata"] as const,
  overview: (scope: "council" | "me") => ["council", "overview", scope] as const,
  events: (filters: object) => ["council", "events", filters] as const,
  log: (filters: EventsQuery) => ["council", "log", filters] as const,
  members: ["council", "members"] as const,
  applicants: (includeBelowCutoff: boolean) => ["council", "applicants", includeBelowCutoff] as const,
}

const REFRESH_MS = 60_000

export function useCouncilRole(): { admin: boolean } | null {
  const session = useOptionalSession()
  return session?.status === "signed-in" ? (session.identity.council ?? null) : null
}

export function useCouncilQueue() {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.queue,
    queryFn: ({ signal }) => fetchCouncilQueue(signal),
    enabled: role !== null,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

export function useSealableVariants(videoId: string | null) {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.sealable(videoId ?? ""),
    queryFn: ({ signal }) => fetchSealableVariants(videoId ?? "", signal),
    enabled: role !== null && videoId !== null,
    staleTime: 15_000,
  })
}

export function useCouncilEdits() {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.edits,
    queryFn: ({ signal }) => fetchCouncilEdits(signal),
    enabled: role !== null,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

export function useCouncilMetadata() {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.metadata,
    queryFn: ({ signal }) => fetchCouncilMetadata(signal),
    enabled: role !== null,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

export function useCouncilOverview(scope: "council" | "me" = "council") {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.overview(scope),
    queryFn: ({ signal }) => fetchCouncilOverview(scope, signal),
    enabled: role !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useCouncilMembers() {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.members,
    queryFn: ({ signal }) => fetchCouncilMembers(signal),
    enabled: role !== null,
    staleTime: 60_000,
  })
}

export function useCouncilApplicants(includeBelowCutoff = false) {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.applicants(includeBelowCutoff),
    queryFn: ({ signal }) => fetchCouncilApplicants(includeBelowCutoff, signal),
    enabled: role !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useCouncilFeed(limit: number, actor?: string) {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.events({ limit, actor }),
    queryFn: ({ signal }) => fetchCouncilEvents({ limit, actor }, signal),
    enabled: role !== null,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

export function useLyricCouncilHistory(lyricId: number) {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.events({ lyric: lyricId }),
    queryFn: ({ signal }) => fetchCouncilEvents({ lyric: lyricId }, signal),
    enabled: role !== null,
    staleTime: 30_000,
  })
}

export function useCouncilLog(filters: Omit<EventsQuery, "cursor">) {
  const role = useCouncilRole()
  return useInfiniteQuery({
    queryKey: councilKeys.log(filters),
    queryFn: ({ pageParam, signal }) => fetchCouncilEvents({ ...filters, cursor: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: role !== null,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
}

export function useOpenWorkCount(): number {
  const queue = useCouncilQueue()
  const edits = useCouncilEdits()
  const metadata = useCouncilMetadata()
  const now = Math.floor(Date.now() / 1000)
  const open = (items: { bookmark: BookmarkView | null }[] | undefined) => openItems(items ?? [], now).length
  return open(queue.data) + open(edits.data?.items) + open(metadata.data?.items)
}
