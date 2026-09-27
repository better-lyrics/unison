import { AUTO_HIDE_PREDICATE_JOINED } from "@/db/predicates"
import type { Confidence, Env, LyricsFormat } from "@/types"

export interface SubmissionRow {
	id: number
	videoId: string
	song: string
	artist: string
	album: string | null
	duration: number
	format: LyricsFormat
	syncType: "richsync" | "linesync" | "plain"
	language: string | null
	effectiveScore: number
	voteCount: number
	confidence: Confidence
	createdAt: number
	hidden: boolean
}

interface RawSubmissionRow {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	duration: number
	format: LyricsFormat
	sync_type: "richsync" | "linesync" | "plain"
	language: string | null
	effective_score: number
	vote_count: number | null
	confidence: Confidence
	created_at: number
	hidden: boolean
}

export async function getLastVoteAt(env: Env, keyId: string): Promise<number | null> {
	const row = await env.DB.prepare(
		`SELECT MAX(v.created_at) AS last_vote_at
		 FROM votes v
		 JOIN users u ON u.id = v.user_id
		 WHERE u.key_id = ?`
	)
		.bind(keyId)
		.first<{ last_vote_at: number | null }>()

	if (!row || row.last_vote_at === null || row.last_vote_at === undefined) return null
	return Number(row.last_vote_at)
}

export type SubmissionSyncType = SubmissionRow["syncType"]
export type SubmissionSort = "newest" | "oldest" | "most_votes" | "least_votes"

export interface SubmissionCursor {
	key: number
	id: number
}

export interface SubmissionFilters {
	search?: string
	syncType?: SubmissionSyncType
	sort: SubmissionSort
}

const SUBMISSION_ORDER: Record<
	SubmissionSort,
	{ column: string; direction: "ASC" | "DESC"; cursorKey: (row: SubmissionRow) => number }
> = {
	newest: { column: "l.created_at", direction: "DESC", cursorKey: (r) => r.createdAt },
	oldest: { column: "l.created_at", direction: "ASC", cursorKey: (r) => r.createdAt },
	most_votes: {
		column: "COALESCE(l.vote_count, 0)",
		direction: "DESC",
		cursorKey: (r) => r.voteCount,
	},
	least_votes: {
		column: "COALESCE(l.vote_count, 0)",
		direction: "ASC",
		cursorKey: (r) => r.voteCount,
	},
}

export function encodeSubmissionCursor(row: SubmissionRow, sort: SubmissionSort): string {
	return `${SUBMISSION_ORDER[sort].cursorKey(row)}:${row.id}`
}

export function decodeSubmissionCursor(raw: string): SubmissionCursor {
	const [key, id] = raw.split(":")
	return { key: Number(key), id: Number(id) }
}

export async function getSubmissionsByUser(
	env: Env,
	keyId: string,
	limit: number,
	cursor: SubmissionCursor | null,
	filters: SubmissionFilters = { sort: "newest" }
): Promise<SubmissionRow[]> {
	const order = SUBMISSION_ORDER[filters.sort]
	const params: unknown[] = [keyId]
	let where = "u.key_id = ? AND l.deleted_at IS NULL"
	if (filters.syncType !== undefined) {
		where += " AND l.sync_type = ?"
		params.push(filters.syncType)
	}
	if (filters.search !== undefined) {
		where += " AND position(LOWER(?) IN LOWER(l.song || ' ' || l.artist)) > 0"
		params.push(filters.search)
	}
	if (cursor !== null) {
		where += ` AND (${order.column}, l.id) ${order.direction === "DESC" ? "<" : ">"} (?, ?)`
		params.push(cursor.key, cursor.id)
	}
	params.push(limit)

	const result = await env.DB.prepare(
		`SELECT l.id, l.video_id, l.song, l.artist, l.album, l.duration,
		        l.format, l.sync_type, l.language, l.effective_score,
		        l.vote_count, l.confidence, l.created_at,
		        ${AUTO_HIDE_PREDICATE_JOINED} AS hidden
		 FROM lyrics l
		 JOIN users u ON u.id = l.submitter_id
		 WHERE ${where}
		 ORDER BY ${order.column} ${order.direction}, l.id ${order.direction}
		 LIMIT ?`
	)
		.bind(...params)
		.all<RawSubmissionRow>()

	return result.results.map((r) => ({
		id: r.id,
		videoId: r.video_id,
		song: r.song,
		artist: r.artist,
		album: r.album,
		duration: r.duration,
		format: r.format,
		syncType: r.sync_type,
		language: r.language,
		effectiveScore: Number(r.effective_score),
		voteCount: Number(r.vote_count ?? 0),
		confidence: r.confidence,
		createdAt: Number(r.created_at),
		hidden: Boolean(r.hidden),
	}))
}

export async function hasSubmissionForVideo(
	env: Env,
	keyId: string,
	videoId: string
): Promise<boolean> {
	const row = await env.DB.prepare(
		`SELECT 1 AS found FROM lyrics l
		 JOIN users u ON u.id = l.submitter_id
		 WHERE u.key_id = ? AND l.video_id = ? AND l.deleted_at IS NULL
		 LIMIT 1`
	)
		.bind(keyId, videoId)
		.first()
	return row !== null
}
