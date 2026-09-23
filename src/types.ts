import type { KVCompat } from "@/infra/cache"
import type { D1Compat } from "@/infra/database"
import type { RedisRateLimiter } from "@/infra/rate-limiter"
import type { JevGate } from "@/services/jev-gate"
import type { TierName } from "@/utils/tiers"

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
	ADMIN_SECRET?: string | null
	DISCORD_OAUTH?: { clientId: string; clientSecret: string; redirectUri: string } | null
	EXAM_DEV_ENABLED?: boolean
	EXAM_BASE_URL?: string
	RAILWAY_PUBLIC_DOMAIN?: string
	JEV?: JevGate
}

export interface RateLimiter {
	limit(options: {
		key: string
		maxRequests?: number
		windowSeconds?: number
	}): Promise<{ success: boolean }>
}

export type LyricsFormat = "ttml" | "lrc" | "plain"

export type SyncType = "richsync" | "linesync" | "plain"

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

export interface BadgeRef {
	key: string
	name: string
	tier?: number
}

export interface SubmitterInfo {
	keyId: string
	reputation: number
	displayName: string
	tier: TierName | null
	level: number
	badgeCount: number
	topBadge: BadgeRef | null
	featured: BadgeRef[]
}

export interface MarkActor {
	keyId: string
	displayName: string
	tier: TierName | null
	level: number
	badgeCount: number
	topBadge: BadgeRef | null
	featured: BadgeRef[]
}

export interface Mark {
	type: string
	label: string
	icon: string
	by?: MarkActor
	at?: number
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
	marks?: Mark[]
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
	submitter_id: number | null
	submitter_key_id?: string | null
	submitter_reputation?: number | null
	submitter_nickname?: string | null
	committee_approved_at?: number | null
	committee_approved_by?: number | null
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
	submitter_id?: number | null
	committee_approved_at?: number | null
	committee_approved_by?: number | null
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

export type RevisionStatus = "live" | "past" | "pending" | "superseded" | "rejected" | "withdrawn"
export type PendingReason = "sealed" | "flagged" | "large_text_drift" | "large_timing_drift"

export interface RevisionAuthor {
	displayName: string
}

export interface RevisionSummary {
	id: number
	revNo: number
	status: RevisionStatus
	pendingReason: PendingReason | null
	isAnchor: boolean
	textDrift: number
	timingDrift: number
	revertsRevNo: number | null
	author: RevisionAuthor | null
	reviewNote: string | null
	createdAt: number
	reviewedAt: number | null
}

export interface RevisionDetail extends RevisionSummary {
	lyrics: string
	format: LyricsFormat
	language: string | null
	isrc: string | null
}

export type CheckStatus = "ok" | "warn" | "bad"

export interface FieldCheck {
	field: "lyrics" | "language" | "isrc"
	status: CheckStatus
	message: string
	line?: number
}

export interface GateOutcome {
	goesLive: boolean
	reason: PendingReason | null
}

export interface RevisionRateLimit {
	lyricRemaining: number
	lyricLimit: number
	userRemaining: number
	userLimit: number
}

export interface PreviewResult {
	checks: FieldCheck[]
	drift: {
		text: number
		timing: number
		timingOffsetMs: number
		textLimit: number
		timingLimit: number
	}
	outcome: GateOutcome
	noChanges: boolean
	rateLimit: RevisionRateLimit
}

export type DiffPart = ["=" | "+" | "-", string]

export interface HeadTextRef {
	kind: "translation" | "transliteration" | "credit"
	lang: string | null
	line: number | null
}

export type DiffRow =
	| { kind: "same"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
	| { kind: "add"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
	| { kind: "del"; lineNo: number; startMs: number | null; text: string; head?: HeadTextRef }
	| { kind: "word"; lineNo: number; startMs: number | null; parts: DiffPart[]; head?: HeadTextRef }
	| { kind: "timing"; lineNo: number; startMs: number; deltaMs: number; text: string }
	| { kind: "gap"; count: number }

export interface RevisionDiff {
	rows: DiffRow[]
	againstRevNo: number | null
}

export interface PendingRevisionCard {
	lyricsId: number
	revisionId: number
	revNo: number
	liveRevNo: number
	videoId: string
	song: string
	artist: string
	format: LyricsFormat
	pendingReason: PendingReason
	jevProbability: number | null
	textDrift: number
	timingDrift: number
	author: RevisionAuthor | null
	createdAt: number
	diffPreview: string
	diffFull: string
}

export interface RevisionBar {
	revNo: number
	count: number
	pending: {
		revNo: number
		pendingReason: PendingReason
		textDrift: number
		timingDrift: number
	} | null
	lastRejected: { revNo: number; reviewNote: string | null } | null
	updatedAt: number
}
