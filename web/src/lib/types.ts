export type LyricsFormat = "ttml" | "lrc" | "plain"
export type SyncType = "richsync" | "linesync" | "plain"
export type Confidence = "low" | "medium" | "high"

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
  discordLinked: boolean
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
  nextCursor?: string
}

export interface LyricsSearchHit {
  id: number
  videoId: string
  song: string
  artist: string
  album?: string
  isrc?: string
  duration: number
  format: LyricsFormat
  language?: string
  syncType: SyncType
  score: number
  effectiveScore: number
  voteCount: number
  confidence: Confidence
  matchScore?: number
}

export interface VariantSubmitter {
  keyId: string
  reputation: number
}

export interface VariantSummary {
  id: number
  videoId: string
  song: string
  artist: string
  album?: string
  isrc?: string
  format: LyricsFormat
  language?: string
  syncType: SyncType
  score: number
  effectiveScore: number
  voteCount: number
  confidence: Confidence
  hidden: boolean
  submitter?: VariantSubmitter
  userVote?: 1 | -1 | null
}

export interface VariantFull extends VariantSummary {
  lyrics: string
}

export interface QueueEntry {
  rank: number
  videoId: string
  song: string
  artist: string
  thumbnailUrl: string | null
  demand: number
  requestCount: number
}

export interface DumpManifest {
  schema_version: 1
  generated_at: string
  sha256: string
  bytes: number
  dump_url: string
  latest_url: string
  row_counts: {
    lyrics: number
    requested_songs: number
    lyrics_requests: number
  }
  format: string
  license: string
  attribution_text: string
  enterprise_contact: string
}
