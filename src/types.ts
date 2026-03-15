import type { D1Compat } from "@/infra/database"
import type { KVCompat } from "@/infra/cache"
import type { RedisRateLimiter } from "@/infra/rate-limiter"

export interface Env {
	DB: D1Compat
	CACHE: KVCompat
	RATE_LIMITER: RedisRateLimiter
	CACHE_TTL_SECONDS: string
}

export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>
}

export type LyricsFormat = "ttml" | "lrc" | "plain"
export type Confidence = "low" | "medium" | "high"

export interface User {
	id: number
	key_id: string
	reputation: number
	vote_count: number
	avg_vote: number
	created_at: number
}

export interface PublicKeyRecord {
	key_id: string
	public_key: string
	created_at: number
}

export interface LyricsRow {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	isrc: string | null
	duration: number
	song_norm: string
	artist_norm: string
	album_norm: string | null
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
	lyrics_text_search: string | null
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
	isrc?: string
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
	isrc?: string
	lyrics: string
	format: LyricsFormat
	language?: string
	syncType: string
	score: number
	effectiveScore: number
	voteCount: number
	confidence: Confidence
	userVote?: 1 | -1 | null
}

export interface LyricsSearchResult {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	isrc: string | null
	duration: number
	format: LyricsFormat
	language: string | null
	sync_type: "richsync" | "linesync" | "plain"
	score: number
	effective_score: number
	vote_count: number
	confidence: Confidence
	created_at: number
	match_score: number
	tier: number
}

export interface FeedItem {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	isrc: string | null
	duration: number
	format: LyricsFormat
	language: string | null
	sync_type: "richsync" | "linesync" | "plain"
	score: number
	effective_score: number
	vote_count: number
	confidence: Confidence
	created_at: number
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
