export interface SongLeaderboardEntry {
  videoId: string
  song: string
  artist: string
  thumbnailUrl: string | null
  demand: number
  requestCount: number
  section: "most_wanted" | "needs_fixing"
  rank: number
}

export interface CuratorLeaderboardEntry {
  keyId: string
  displayName: string
  reputation: number
  score: number
  submissionCount: number
  totalUpvotes: number
  rank: number
}

export interface SongsLeaderboardResponse {
  mostWanted: SongLeaderboardEntry[]
  needsFixing: SongLeaderboardEntry[]
}

export interface CuratorsLeaderboardResponse {
  curators: CuratorLeaderboardEntry[]
}

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}
