import type { ApiEnvelope, CuratorsLeaderboardResponse, SongsLeaderboardResponse } from "./types"

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
