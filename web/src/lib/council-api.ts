import { getJsonWithSignal } from "./api"
import { authedFetch } from "./authedFetch"
import type {
  ApplicantView,
  BookmarkItemType,
  CouncilBookmark,
  CouncilOverview,
  EditsPayload,
  EventGroup,
  EventsPage,
  OpinionStance,
  QueueItem,
  RosterMember,
} from "./council-types"

const JSON_HEADERS = { "content-type": "application/json" }

function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return authedFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  })
}

export function fetchCouncilQueue(signal?: AbortSignal): Promise<QueueItem[]> {
  return getJsonWithSignal("/committee/queue", signal)
}

export function fetchCouncilEdits(signal?: AbortSignal): Promise<EditsPayload> {
  return getJsonWithSignal("/committee/edits", signal)
}

export interface EventsQuery {
  kind?: EventGroup
  actor?: string
  lyric?: number
  includeBookmarks?: boolean
  cursor?: string
  limit?: number
}

export function fetchCouncilEvents(query: EventsQuery, signal?: AbortSignal): Promise<EventsPage> {
  const params = new URLSearchParams()
  if (query.kind) params.set("kind", query.kind)
  if (query.actor) params.set("actor", query.actor)
  if (query.lyric !== undefined) params.set("lyric", String(query.lyric))
  if (query.includeBookmarks) params.set("includeBookmarks", "1")
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.limit !== undefined) params.set("limit", String(query.limit))
  const qs = params.toString()
  return getJsonWithSignal(qs ? `/committee/events?${qs}` : "/committee/events", signal)
}

export function fetchCouncilOverview(scope: "council" | "me", signal?: AbortSignal): Promise<CouncilOverview> {
  return getJsonWithSignal(scope === "me" ? "/committee/overview?scope=me" : "/committee/overview", signal)
}

export function fetchCouncilMembers(signal?: AbortSignal): Promise<RosterMember[]> {
  return getJsonWithSignal("/committee/members", signal)
}

export function fetchCouncilApplicants(includeBelowCutoff: boolean, signal?: AbortSignal): Promise<ApplicantView[]> {
  return getJsonWithSignal(
    includeBelowCutoff ? "/committee/applicants?includeBelowCutoff=1" : "/committee/applicants",
    signal,
  )
}

export function createBookmark(itemType: BookmarkItemType, itemId: number): Promise<CouncilBookmark> {
  return send("/committee/bookmarks", "POST", { itemType, itemId })
}

export function releaseBookmark(id: number): Promise<void> {
  return send(`/committee/bookmarks/${id}`, "DELETE")
}

export function sealLyric(lyricsId: number): Promise<void> {
  return send(`/lyrics/${lyricsId}/boost`, "POST", {})
}

export function unsealLyric(lyricsId: number): Promise<void> {
  return send(`/lyrics/${lyricsId}/boost`, "DELETE")
}

export function rejectLyric(lyricsId: number, note: string | null): Promise<void> {
  return send(`/lyrics/${lyricsId}/reject`, "POST", { note })
}

export function undoRejectLyric(lyricsId: number): Promise<void> {
  return send(`/lyrics/${lyricsId}/reject`, "DELETE")
}

export function decideEdit(
  lyricsId: number,
  revisionId: number,
  decision: "approve" | "reject",
  note: string | null = null,
): Promise<void> {
  return send(`/lyrics/${lyricsId}/revisions/${revisionId}/${decision}`, "POST", decision === "reject" ? { note } : {})
}

export function setApplicantOpinion(applicantId: number, stance: OpinionStance | null, note?: string): Promise<void> {
  return send(`/committee/applicants/${applicantId}/opinion`, "PUT", { stance, note })
}

export function decideApplicant(applicantId: number, decision: "approve" | "reject"): Promise<void> {
  return send(`/committee/applicants/${applicantId}/decision`, "POST", { decision })
}

export function addCouncilMember(keyId: string): Promise<void> {
  return send("/committee/members", "POST", { keyId })
}

export function removeCouncilMember(keyId: string): Promise<void> {
  return send(`/committee/members/${encodeURIComponent(keyId)}`, "DELETE")
}
