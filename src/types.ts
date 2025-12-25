export interface Env {
	DB: D1Database
	CACHE: KVNamespace
	RATE_LIMITER: RateLimiter
	CACHE_TTL_SECONDS: string
}

export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>
}

export type LyricsFormat = "ttml" | "lrc" | "plain"
export type Confidence = "low" | "medium" | "high"

export interface User {
	id: number
	device_hash: string
	reputation: number
	vote_count: number
	avg_vote: number
	created_at: number
}

export interface LyricsRow {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	duration_ms: number
	song_norm: string
	artist_norm: string
	lyrics: string
	format: LyricsFormat
	language: string | null
	sync_type: "richsync" | "linesync" | "plain"
	score: number
	upvotes: number
	downvotes: number
	effective_score: number
	vote_count: number
	diversity_bonus: number
	confidence: Confidence
	score_updated_at: number | null
	created_at: number
	updated_at: number
	submitter_id: number | null
}

export interface LyricsSubmission {
	videoId: string
	song: string
	artist: string
	album?: string
	duration: number
	lyrics: string
	format: LyricsFormat
	language?: string
	syncType?: "richsync" | "linesync" | "plain"
}

export interface LyricsResponse {
	id: number
	videoId: string
	song: string
	artist: string
	album?: string
	lyrics: string
	format: LyricsFormat
	language?: string
	syncType: string
	score: number
	effectiveScore: number
	voteCount: number
	confidence: Confidence
}

export interface VoteRequest {
	vote: 1 | -1
}

export interface ReportRequest {
	reason: "wrong_song" | "bad_sync" | "offensive" | "spam" | "other"
	details?: string
}

export interface ApiResponse<T = unknown> {
	success: boolean
	data?: T
	error?: string
}
