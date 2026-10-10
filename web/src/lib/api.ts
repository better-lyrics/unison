import { loadStoredSession } from "./auth"
import { AUTHED_FETCH_ERRORS, authedFetch } from "./authedFetch"
import type { ReportReason } from "./report-reasons"
import type { RevisionDiff, RevisionSummary } from "./revision-types"
import { IS_SPA_EXPANSION_SEED } from "./seed-flag"
import type {
  ApiEnvelope,
  AvatarCatalogue,
  AvatarChoice,
  BadgeCatalogue,
  CuratorsLeaderboardResponse,
  DumpManifest,
  FeedEntry,
  LyricsSearchHit,
  Page,
  QueueEntry,
  SealedSort,
  SealedSyncFilter,
  SongsLeaderboardResponse,
  SubmissionSort,
  SubmissionSyncType,
  UserGamification,
  UserRankResponse,
  UserSubmissionsResponse,
  VariantFull,
  VariantSummary,
} from "./types"

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("HTTP 404 ")
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  const envelope = (await res.json()) as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export async function fetchSongLeaderboard(): Promise<SongsLeaderboardResponse> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedSongs()
  return getJson<SongsLeaderboardResponse>("/leaderboard/songs")
}

export async function fetchCuratorLeaderboard(): Promise<CuratorsLeaderboardResponse> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedCurators()
  return getJson<CuratorsLeaderboardResponse>("/leaderboard/users")
}

export async function fetchUserRank(keyId: string): Promise<UserRankResponse> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedUserRank(keyId)
  return getJson<UserRankResponse>(`/leaderboard/users/${encodeURIComponent(keyId)}`)
}

export async function fetchUserByHandle(handle: string): Promise<{ keyId: string }> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedUserByHandle(handle)
  return getJson<{ keyId: string }>(`/users/by-handle/${encodeURIComponent(handle)}`)
}

export interface UserSubmissionsQuery {
  search?: string
  syncType?: SubmissionSyncType
  sort?: SubmissionSort
  cursor?: string
}

export async function fetchUserSubmissions(
  keyId: string,
  query: UserSubmissionsQuery = {},
): Promise<UserSubmissionsResponse> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedUserSubmissions(keyId)
  const params = new URLSearchParams()
  const search = query.search?.trim()
  if (search) params.set("q", search)
  if (query.syncType) params.set("syncType", query.syncType)
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort)
  if (query.cursor !== undefined) params.set("cursor", query.cursor)
  const qs = params.toString()
  return getJson<UserSubmissionsResponse>(`/users/${encodeURIComponent(keyId)}/submissions${qs ? `?${qs}` : ""}`)
}

export async function fetchBadgeCatalogue(): Promise<BadgeCatalogue> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedBadgeCatalogue()
  return getJson<BadgeCatalogue>("/badges")
}

export async function fetchAvatarCatalogue(): Promise<AvatarCatalogue> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedAvatarCatalogue()
  return getJson<AvatarCatalogue>("/avatars")
}

export async function putAvatar(choice: AvatarChoice): Promise<{ avatarUrl: string | null }> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedSetAvatar(choice)
  return authedFetch<{ avatarUrl: string | null }>("/avatars/me", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(choice),
  })
}

export async function fetchUserBadges(keyId: string): Promise<UserGamification> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedUserBadges(keyId)
  return getJson<UserGamification>(`/users/${encodeURIComponent(keyId)}/badges`)
}

export async function putFeaturedBadges(keyId: string, featured: string[]): Promise<UserGamification> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed")).seedSetFeatured(keyId, featured)
  return authedFetch<UserGamification>("/users/me/featured-badges", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ featured }),
  })
}

interface SearchLyricsParams {
  q?: string
  song?: string
  artist?: string
  signal?: AbortSignal
}

function buildSearchPath(params: SearchLyricsParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.song) search.set("song", params.song)
  if (params.artist) search.set("artist", params.artist)
  const qs = search.toString()
  return qs.length > 0 ? `/lyrics/search?${qs}` : "/lyrics/search"
}

export async function getJsonWithSignal<T>(path: string, signal?: AbortSignal): Promise<T> {
  const session = loadStoredSession()
  const init: RequestInit = {}
  if (signal) init.signal = signal
  if (session) init.headers = { authorization: `Bearer ${session.sessionToken}` }
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  const envelope = (await res.json()) as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export async function searchLyrics(params: SearchLyricsParams): Promise<{ results: LyricsSearchHit[] }> {
  if (IS_SPA_EXPANSION_SEED) {
    return (await import("./dev-seed-spa-expansion")).seedSearch({
      q: params.q,
      song: params.song,
      artist: params.artist,
    })
  }
  const hits = await getJsonWithSignal<LyricsSearchHit[]>(buildSearchPath(params), params.signal)
  return { results: hits }
}

export async function fetchLyricsVariants(
  videoId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ variants: VariantSummary[] }> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedLyricsVariants(videoId)
  const variants = await getJsonWithSignal<VariantSummary[]>(
    `/lyrics/variants/${encodeURIComponent(videoId)}`,
    opts.signal,
  )
  return { variants }
}

export async function fetchLyricsVariant(
  id: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ variant: VariantFull }> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedLyricsVariant(id)
  const variant = await getJsonWithSignal<VariantFull>(`/lyrics/${id}`, opts.signal)
  return { variant }
}

export function fetchRevisionDiff(lyricsId: number, revisionId: number, signal?: AbortSignal): Promise<RevisionDiff> {
  return getJsonWithSignal(`/lyrics/${lyricsId}/revisions/${revisionId}/diff`, signal)
}

export async function fetchRevisions(lyricsId: number, signal?: AbortSignal): Promise<RevisionSummary[]> {
  const { revisions } = await getJsonWithSignal<{ revisions: RevisionSummary[] }>(
    `/lyrics/${lyricsId}/revisions`,
    signal,
  )
  return revisions
}

export async function fetchArtwork(videoId: string, size?: number): Promise<string | null> {
  if (IS_SPA_EXPANSION_SEED) return null
  const sized = size !== undefined ? `&size=${size}` : ""
  const { artworkUrl } = await getJson<{ artworkUrl: string | null }>(
    `/artwork?v=${encodeURIComponent(videoId)}${sized}`,
  )
  return artworkUrl
}

async function unwrapMutationError(res: Response): Promise<never> {
  if (res.status === 401) throw new Error(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  if (res.status === 429) throw new Error(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  let body: { error?: unknown } | null = null
  try {
    body = (await res.json()) as { error?: unknown }
  } catch {
    body = null
  }
  const message = typeof body?.error === "string" && body.error.length > 0 ? body.error : null
  throw new Error(message ?? AUTHED_FETCH_ERRORS.REQUEST_FAILED)
}

export async function voteVariant(id: number, value: 1 | -1): Promise<void> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedVote(id, value)
  await authedFetch<unknown>(`/lyrics/${id}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vote: value }),
  })
}

export async function unvoteVariant(id: number): Promise<void> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedUnvote(id)
  await authedFetch<unknown>(`/lyrics/${id}/vote`, { method: "DELETE" })
}

export async function reportVariant(
  id: number,
  reason: ReportReason,
  details?: string,
): Promise<void> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedReport(id, reason, details)
  const body = details !== undefined ? { reason, details } : { reason }
  await authedFetch<unknown>(`/lyrics/${id}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const QUEUE_PAGE_LIMIT = 50

export async function fetchQueue(opts: { cursor?: string; signal?: AbortSignal } = {}): Promise<Page<QueueEntry>> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedQueue({ cursor: opts.cursor })
  const search = new URLSearchParams()
  search.set("cursor", opts.cursor ?? "")
  search.set("limit", String(QUEUE_PAGE_LIMIT))
  return getPage<QueueEntry>(`/leaderboard/songs?${search.toString()}`, opts.signal)
}

export async function fetchSealed(opts: {
  sort: SealedSort
  limit: number
  syncType?: SealedSyncFilter
  cursor?: string
  signal?: AbortSignal
}): Promise<Page<FeedEntry>> {
  if (IS_SPA_EXPANSION_SEED) return (await import("./dev-seed-spa-expansion")).seedSealed(opts)
  const search = new URLSearchParams({ sealed: "1", sort: opts.sort, limit: String(opts.limit) })
  if (opts.syncType) search.set("syncType", opts.syncType)
  if (opts.cursor) search.set("cursor", opts.cursor)
  return getPage<FeedEntry>(`/feed?${search.toString()}`, opts.signal)
}

async function getPage<T>(path: string, signal?: AbortSignal): Promise<Page<T>> {
  const res = await fetch(path, signal ? { signal } : undefined)
  if (!res.ok) await unwrapMutationError(res)
  const body = (await res.json()) as ApiEnvelope<T[]> & { nextCursor?: string | number | null }
  if (!body.success) throw new Error(body.error)
  return { items: body.data, nextCursor: body.nextCursor == null ? null : String(body.nextCursor) }
}

const DUMP_MANIFEST_URL = "https://unison-dumps.boidu.dev/dumps/manifest.json"

export async function fetchDumpManifest(): Promise<DumpManifest> {
  const res = await fetch(DUMP_MANIFEST_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching dump manifest`)
  try {
    return (await res.json()) as DumpManifest
  } catch {
    throw new Error("manifest is malformed")
  }
}
