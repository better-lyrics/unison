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

export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: string }

export interface UserStats {
  keyId: string
  displayName: string
  lastVoteAt: number | null
}

export interface RankedUserStats extends UserStats {
  ranked: true
  reputation: number
  score: number
  submissionCount: number
  totalUpvotes: number
  rank: number
}

export interface UnrankedUserStats extends UserStats {
  ranked: false
}

export type UserRankResponse = RankedUserStats | UnrankedUserStats

export interface UserSubmission {
  id: number
  videoId: string
  song: string
  artist: string
  album?: string
  duration: number
  format: "ttml" | "lrc" | "plain"
  syncType: "richsync" | "linesync" | "plain"
  language?: string
  effectiveScore: number
  voteCount: number
  confidence: "low" | "medium" | "high"
  createdAt: number
  hidden: boolean
}

export interface UserSubmissionsResponse {
  submissions: UserSubmission[]
  nextCursor?: number
}
