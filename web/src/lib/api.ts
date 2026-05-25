import type {
  ApiEnvelope,
  CuratorsLeaderboardResponse,
  SongsLeaderboardResponse,
  UserRankResponse,
  UserSubmissionsResponse,
} from "./types"

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  const envelope = (await res.json()) as ApiEnvelope<T>
  if (!envelope.success) throw new Error(envelope.error)
  return envelope.data
}

export function fetchSongLeaderboard(): Promise<SongsLeaderboardResponse> {
  return getJson<SongsLeaderboardResponse>("/leaderboard/songs")
}

export function fetchCuratorLeaderboard(): Promise<CuratorsLeaderboardResponse> {
  return getJson<CuratorsLeaderboardResponse>("/leaderboard/users")
}

export function fetchUserRank(keyId: string): Promise<UserRankResponse> {
  return getJson<UserRankResponse>(`/leaderboard/users/${encodeURIComponent(keyId)}`)
}

export function fetchUserSubmissions(keyId: string, cursor?: number): Promise<UserSubmissionsResponse> {
  const params = cursor !== undefined ? `?cursor=${cursor}` : ""
  return getJson<UserSubmissionsResponse>(`/users/${encodeURIComponent(keyId)}/submissions${params}`)
}
