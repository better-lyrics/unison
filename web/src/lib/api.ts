import { AUTHED_FETCH_ERRORS, authedFetch } from "./authedFetch"
import type {
  ApiEnvelope,
  CuratorsLeaderboardResponse,
  DumpManifest,
  LyricsSearchHit,
  QueueEntry,
  SongsLeaderboardResponse,
  UserRankResponse,
  UserSubmissionsResponse,
  VariantFull,
  VariantSummary,
} from "./types"

const USE_SEED = import.meta.env.MODE === "development" && import.meta.env.VITE_USE_API !== "1"

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  const envelope = (await res.json()) as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export async function fetchSongLeaderboard(): Promise<SongsLeaderboardResponse> {
  if (USE_SEED) return (await import("./dev-seed")).seedSongs()
  return getJson<SongsLeaderboardResponse>("/leaderboard/songs")
}

export async function fetchCuratorLeaderboard(): Promise<CuratorsLeaderboardResponse> {
  if (USE_SEED) return (await import("./dev-seed")).seedCurators()
  return getJson<CuratorsLeaderboardResponse>("/leaderboard/users")
}

export async function fetchUserRank(keyId: string): Promise<UserRankResponse> {
  if (USE_SEED) return (await import("./dev-seed")).seedUserRank(keyId)
  return getJson<UserRankResponse>(`/leaderboard/users/${encodeURIComponent(keyId)}`)
}

export async function fetchUserSubmissions(keyId: string, cursor?: string): Promise<UserSubmissionsResponse> {
  if (USE_SEED) return (await import("./dev-seed")).seedUserSubmissions(keyId)
  const params = cursor !== undefined ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return getJson<UserSubmissionsResponse>(`/users/${encodeURIComponent(keyId)}/submissions${params}`)
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

async function getJsonWithSignal<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, signal ? { signal } : undefined)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  const envelope = (await res.json()) as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export async function searchLyrics(params: SearchLyricsParams): Promise<{ results: LyricsSearchHit[] }> {
  const hits = await getJsonWithSignal<LyricsSearchHit[]>(buildSearchPath(params), params.signal)
  return { results: hits }
}

export async function fetchLyricsVariants(
  videoId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ variants: VariantSummary[] }> {
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
  const variant = await getJsonWithSignal<VariantFull>(`/lyrics/${id}`, opts.signal)
  return { variant }
}

async function unwrapMutationError(res: Response): Promise<never> {
  if (res.status === 401) throw new Error(AUTHED_FETCH_ERRORS.AUTH_REQUIRED)
  if (res.status === 429) throw new Error(AUTHED_FETCH_ERRORS.RATE_LIMITED)
  try {
    const body = (await res.json()) as { error?: unknown }
    const message = typeof body.error === "string" && body.error.length > 0 ? body.error : null
    throw new Error(message ?? AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  } catch (err) {
    if (err instanceof Error && err.message) throw err
    throw new Error(AUTHED_FETCH_ERRORS.REQUEST_FAILED)
  }
}

export async function voteVariant(id: number, value: 1 | -1): Promise<void> {
  await authedFetch<unknown>(`/lyrics/${id}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vote: value }),
  })
}

export async function unvoteVariant(id: number): Promise<void> {
  await authedFetch<unknown>(`/lyrics/${id}/vote`, { method: "DELETE" })
}

export async function reportVariant(
  id: number,
  reason: "wrong_song" | "bad_sync" | "offensive" | "spam" | "other",
  details?: string,
): Promise<void> {
  const body = details !== undefined ? { reason, details } : { reason }
  await authedFetch<unknown>(`/lyrics/${id}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const QUEUE_PAGE_LIMIT = 50

export async function fetchQueue(
  opts: { cursor?: string; signal?: AbortSignal } = {},
): Promise<{ items: QueueEntry[]; nextCursor: string | null }> {
  const search = new URLSearchParams()
  search.set("cursor", opts.cursor ?? "")
  search.set("limit", String(QUEUE_PAGE_LIMIT))
  const path = `/leaderboard/songs?${search.toString()}`
  const res = await fetch(path, opts.signal ? { signal: opts.signal } : undefined)
  if (!res.ok) {
    await unwrapMutationError(res)
  }
  const body = (await res.json()) as ApiEnvelope<QueueEntry[]> & { nextCursor?: string | null }
  if (!body.success) throw new Error(body.error)
  return { items: body.data, nextCursor: body.nextCursor ?? null }
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
