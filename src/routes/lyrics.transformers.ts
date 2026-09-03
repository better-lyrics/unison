import type {
	Confidence,
	LyricsFulfillmentBadge,
	LyricsResponse,
	LyricsSearchResult,
	SubmitterInfo,
} from "@/types"
import { generatePetName } from "@/utils/petname"

function buildSubmitter(row: {
	submitter_key_id?: string | null
	submitter_reputation?: number | null
	submitter_nickname?: string | null
}): SubmitterInfo | undefined {
	if (row.submitter_key_id == null || row.submitter_reputation == null) return undefined
	return {
		keyId: row.submitter_key_id,
		reputation: row.submitter_reputation,
		displayName: row.submitter_nickname ?? generatePetName(row.submitter_key_id),
	}
}

export interface LyricsRowForResponse {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	isrc: string | null
	lyrics: string
	format: "ttml" | "lrc" | "plain"
	language: string | null
	sync_type: string
	score: number
	effective_score: number
	vote_count: number
	confidence: Confidence
	submitter_key_id?: string | null
	submitter_reputation?: number | null
	submitter_nickname?: string | null
	hidden?: boolean
}

export function toResponse(
	row: LyricsRowForResponse,
	fulfilled?: LyricsFulfillmentBadge | null
): LyricsResponse {
	return {
		id: row.id,
		videoId: row.video_id,
		song: row.song,
		artist: row.artist,
		album: row.album || undefined,
		isrc: row.isrc || undefined,
		lyrics: row.lyrics,
		format: row.format,
		language: row.language || undefined,
		syncType: row.sync_type,
		score: row.score,
		effectiveScore: row.effective_score,
		voteCount: row.vote_count,
		confidence: row.confidence,
		hidden: row.hidden ?? false,
		submitter: buildSubmitter(row),
		fulfilled: fulfilled ?? undefined,
	}
}

export function toSearchResponse(row: LyricsSearchResult) {
	return {
		id: row.id,
		videoId: row.video_id,
		song: row.song,
		artist: row.artist,
		album: row.album || undefined,
		isrc: row.isrc || undefined,
		duration: row.duration,
		format: row.format,
		language: row.language || undefined,
		syncType: row.sync_type,
		score: row.score,
		effectiveScore: row.effective_score,
		voteCount: row.vote_count,
		confidence: row.confidence,
		matchScore: row.match_score,
		submitter: buildSubmitter(row),
	}
}
