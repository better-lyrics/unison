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
	vote_count: number
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

export async function getSubmissionsByUser(
	env: Env,
	keyId: string,
	limit: number,
	cursor: { createdAt: number; id: number } | null
): Promise<SubmissionRow[]> {
	const params: unknown[] = [keyId]
	let where = "u.key_id = ? AND l.deleted_at IS NULL"
	if (cursor !== null) {
		where += " AND (l.created_at, l.id) < (?, ?)"
		params.push(cursor.createdAt, cursor.id)
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
		 ORDER BY l.created_at DESC, l.id DESC
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
		voteCount: Number(r.vote_count),
		confidence: r.confidence,
		createdAt: Number(r.created_at),
		hidden: Boolean(r.hidden),
	}))
}
