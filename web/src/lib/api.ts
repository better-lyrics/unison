import type {
  ApiEnvelope,
  CuratorsLeaderboardResponse,
  DumpManifest,
  SongsLeaderboardResponse,
  UserRankResponse,
  UserSubmissionsResponse,
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

const DUMP_MANIFEST_URL = "https://unison-dumps.boidu.dev/dumps/manifest.json"

export async function fetchDumpManifest(): Promise<DumpManifest> {
  const res = await fetch(DUMP_MANIFEST_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching dump manifest`)
  return (await res.json()) as DumpManifest
}
