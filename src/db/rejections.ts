import { isCommittee } from "@/db/committee"
import { type FeedFilters, buildOrderByClause } from "@/db/feed-filters"
import { AUTO_HIDE_PREDICATE_JOINED, RANKING_EXPR_JOINED } from "@/db/predicates"
import type { Env, LyricsFormat } from "@/types"

export type QueueSort = "top-rated" | "most-voted"

export interface SealCandidate {
	id: number
	video_id: string
	song: string
	artist: string
	format: LyricsFormat
	score: number
	vote_count: number
	lyrics: string
	submitter_key_id: string | null
	submitter_nickname: string | null
}

export type RejectResult =
	| { ok: true }
	| { ok: false; reason: "not_committee" | "lyric_not_found" | "already_rejected" }

export type UndoRejectResult = { ok: true } | { ok: false; reason: "not_committee" | "not_found" }

export async function getSealCandidates(
	env: Env,
	opts: { limit: number; sort: QueueSort }
): Promise<SealCandidate[]> {
	const orderBy = buildOrderByClause(
		{ sort: opts.sort } as FeedFilters,
		`${RANKING_EXPR_JOINED} DESC`
	)

	const sql = `
		SELECT id, video_id, song, artist, format, score, vote_count, lyrics,
			submitter_key_id, submitter_nickname
		FROM (
			SELECT DISTINCT ON (l.video_id)
				l.id, l.video_id, l.song, l.artist, l.format, l.score, l.effective_score,
				l.vote_count, l.lyrics, u.key_id AS submitter_key_id, u.nickname AS submitter_nickname
			FROM lyrics l
			LEFT JOIN users u ON u.id = l.submitter_id
			WHERE l.deleted_at IS NULL
				AND l.committee_approved_at IS NULL
				AND l.effective_score > 0
				AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
				AND NOT EXISTS (
					SELECT 1 FROM rejections r WHERE r.lyrics_id = l.id AND r.revoked_at IS NULL
				)
			ORDER BY l.video_id, ${RANKING_EXPR_JOINED} DESC
		) AS unique_videos
		ORDER BY ${orderBy}
		LIMIT ?
	`

	const result = await env.DB.prepare(sql).bind(opts.limit).all<SealCandidate>()
	return result.results
}

export async function rejectLyric(
	env: Env,
	lyricsId: number,
	userId: number,
	note?: string
): Promise<RejectResult> {
	if (!(await isCommittee(env, userId))) {
		return { ok: false, reason: "not_committee" }
	}

	const lyric = await env.DB.prepare("SELECT id FROM lyrics WHERE id = ? AND deleted_at IS NULL")
		.bind(lyricsId)
		.first<{ id: number }>()
	if (!lyric) {
		return { ok: false, reason: "lyric_not_found" }
	}

	const now = Math.floor(Date.now() / 1000)
	try {
		await env.DB.prepare(
			"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at, note) VALUES (?, ?, ?, ?)"
		)
			.bind(lyricsId, userId, now, note ?? null)
			.run()
	} catch (err) {
		if ((err as { code?: string }).code === "23505") {
			return { ok: false, reason: "already_rejected" }
		}
		throw err
	}
	return { ok: true }
}

export async function undoRejection(
	env: Env,
	lyricsId: number,
	userId: number
): Promise<UndoRejectResult> {
	if (!(await isCommittee(env, userId))) {
		return { ok: false, reason: "not_committee" }
	}

	const now = Math.floor(Date.now() / 1000)
	const revoked = await env.DB.prepare(
		"UPDATE rejections SET revoked_at = ? WHERE lyrics_id = ? AND revoked_at IS NULL RETURNING id"
	)
		.bind(now, lyricsId)
		.first<{ id: number }>()
	if (!revoked) {
		return { ok: false, reason: "not_found" }
	}
	return { ok: true }
}
