import type { KVCompat } from "@/infra/cache"
import type { D1Compat } from "@/infra/database"
import type { RedisRateLimiter } from "@/infra/rate-limiter"

export interface B2Config {
	keyId: string
	applicationKey: string
	bucket: string
	endpoint: string
}

export interface Env {
	DB: D1Compat
	CACHE: KVCompat
	RATE_LIMITER: RedisRateLimiter
	READ_RATE_LIMITER: RedisRateLimiter
	CACHE_TTL_SECONDS: string
	DUMPS_ENABLED: boolean
	DUMP_PUBLIC_BASE_URL: string
	DUMP_DATABASE_URL: string | null
	B2: B2Config | null
	BUTLER_BOT_SECRET?: string | null
	DISCORD_OAUTH?: { clientId: string; clientSecret: string; redirectUri: string } | null
	TRANSLATION_PROXY_ENABLED?: boolean
}

export interface RateLimiter {
	limit(options: {
		key: string
		maxRequests?: number
		windowSeconds?: number
	}): Promise<{ success: boolean }>
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
	submitter_key_id?: string | null
	submitter_reputation?: number | null
	submitter_nickname?: string | null
	deleted_at: number | null
	deleted_by_user_id: number | null
	deleted_by_role: "submitter" | "admin" | null
	deletion_reason: string | null
	hidden?: boolean
}

export interface SubmitterInfo {
	keyId: string
	reputation: number
	displayName: string
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
	syncType: "richsync" | "linesync" | "plain"
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
	hidden: boolean
	submitter?: SubmitterInfo
	fulfilled?: LyricsFulfillmentBadge | null
	userVote?: 1 | -1 | null
}

export interface LyricsFulfillmentBadge {
	demand: number
	requestCount: number
	fulfilledAt: number
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
	hidden?: boolean
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
