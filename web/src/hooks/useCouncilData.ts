import { useSession } from "@/auth/useSession"
import {
  fetchCouncilApplicants,
  fetchCouncilEdits,
  fetchCouncilEvents,
  fetchCouncilMembers,
  fetchCouncilOverview,
  fetchCouncilQueue,
} from "@/lib/council-api"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

export const councilKeys = {
  all: ["council"] as const,
  queue: ["council", "queue"] as const,
  edits: ["council", "edits"] as const,
  overview: (scope: "council" | "me") => ["council", "overview", scope] as const,
  events: (filters: object) => ["council", "events", filters] as const,
  members: ["council", "members"] as const,
  applicants: (includeBelowCutoff: boolean) => ["council", "applicants", includeBelowCutoff] as const,
}

const REFRESH_MS = 60_000

export function useCouncilRole(): { admin: boolean } | null {
  const session = useSession()
  return session.status === "signed-in" ? (session.identity.council ?? null) : null
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
  })
}

export function useCouncilFeed() {
  const role = useCouncilRole()
  return useQuery({
    queryKey: councilKeys.events({}),
    queryFn: ({ signal }) => fetchCouncilEvents({}, signal),
    enabled: role !== null,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

export function useOpenWorkCount(): number {
  const queue = useCouncilQueue()
  const edits = useCouncilEdits()
  const open = (items: { bookmark: unknown }[] | undefined) => items?.filter((i) => i.bookmark === null).length ?? 0
  return open(queue.data) + open(edits.data?.items)
}
