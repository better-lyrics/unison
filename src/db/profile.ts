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
	offset: number
): Promise<SubmissionRow[]> {
	const result = await env.DB.prepare(
		`SELECT l.id, l.video_id, l.song, l.artist, l.album, l.duration,
		        l.format, l.sync_type, l.language, l.effective_score,
		        l.vote_count, l.confidence, l.created_at
		 FROM lyrics l
		 JOIN users u ON u.id = l.submitter_id
		 WHERE u.key_id = ? AND l.deleted_at IS NULL
		 ORDER BY l.created_at DESC
		 LIMIT ? OFFSET ?`
	)
		.bind(keyId, limit, offset)
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
	}))
}
