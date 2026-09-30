import { isCommittee } from "@/db/committee"
import { releaseBookmarksForItem } from "@/db/council-bookmarks"
import { type CouncilSource, recordCouncilEvent } from "@/db/council-events"
import { type FeedFilters, buildOrderByClause } from "@/db/feed-filters"
import {
	AUTO_HIDE_PREDICATE_JOINED,
	RANKING_EXPR_JOINED,
	UNDECIDED_LYRIC_JOINED,
	videoServesExpr,
} from "@/db/predicates"
import { type D1Compat, isUniqueViolation } from "@/infra/database"
import type { Confidence, Env, LyricsFormat, SyncType } from "@/types"

export type QueueSort = "top-rated" | "most-voted"

export interface SealCandidate {
	id: number
	video_id: string
	song: string
	artist: string
	format: LyricsFormat
	score: number
	vote_count: number
	submitter_id: number | null
	submitter_key_id: string | null
	submitter_nickname: string | null
	effective_score: number
	upvotes: number
	downvotes: number
	confidence: Confidence
	language: string | null
	sync_type: SyncType
	created_at: number
	current_revision_id: number | null
}

export type RejectResult =
	| { ok: true; rejectionId: number }
	| { ok: false; reason: "not_committee" | "lyric_not_found" | "already_rejected" | "sealed" }

export type UndoRejectResult = { ok: true } | { ok: false; reason: "not_committee" | "not_found" }

const CANDIDATE_COLUMNS = `l.id, l.video_id, l.song, l.artist, l.format, l.score, l.effective_score,
	l.vote_count, l.submitter_id, u.key_id AS submitter_key_id,
	u.nickname AS submitter_nickname, l.upvotes, l.downvotes, l.confidence, l.language,
	l.sync_type, l.created_at, l.current_revision_id`

const SEAL_ELIGIBLE_JOINED = `${UNDECIDED_LYRIC_JOINED}
	AND l.effective_score > 0
	AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
	AND NOT EXISTS (SELECT 1 FROM committee_members c WHERE c.user_id = l.submitter_id)`

export async function getSealCandidates(
	env: Env,
	opts: { limit: number; sort: QueueSort }
): Promise<SealCandidate[]> {
	const orderBy = buildOrderByClause(
		{ sort: opts.sort } as FeedFilters,
		`${RANKING_EXPR_JOINED} DESC`
	)

	const sql = `
		SELECT id, video_id, song, artist, format, score, vote_count, submitter_id,
			submitter_key_id, submitter_nickname, effective_score, upvotes, downvotes, confidence,
			language, sync_type, created_at, current_revision_id
		FROM (
			SELECT DISTINCT ON (l.video_id) ${CANDIDATE_COLUMNS}
			FROM lyrics l
			LEFT JOIN users u ON u.id = l.submitter_id
			WHERE ${SEAL_ELIGIBLE_JOINED}
			ORDER BY l.video_id, ${RANKING_EXPR_JOINED} DESC
		) AS unique_videos
		ORDER BY ${orderBy}
		LIMIT ?
	`

	const result = await env.DB.prepare(sql).bind(opts.limit).all<SealCandidate>()
	return result.results
}

export async function getSealCandidatesByIds(env: Env, ids: number[]): Promise<SealCandidate[]> {
	if (ids.length === 0) return []
	const result = await env.DB.prepare(
		`SELECT ${CANDIDATE_COLUMNS}
		 FROM lyrics l
		 LEFT JOIN users u ON u.id = l.submitter_id
		 WHERE l.id = ANY(?) AND ${SEAL_ELIGIBLE_JOINED}`
	)
		.bind(ids)
		.all<SealCandidate>()
	return result.results
}

export async function getSealableVariants(env: Env, videoId: string): Promise<SealCandidate[]> {
	const result = await env.DB.prepare(
		`SELECT ${CANDIDATE_COLUMNS}
		 FROM lyrics l
		 LEFT JOIN users u ON u.id = l.submitter_id
		 WHERE ${videoServesExpr("l.")} AND ${SEAL_ELIGIBLE_JOINED}
		 ORDER BY ${RANKING_EXPR_JOINED} DESC`
	)
		.bind(videoId, videoId)
		.all<SealCandidate>()
	return result.results
}

export async function rejectLyric(
	env: Env,
	lyricsId: number,
	userId: number,
	opts: { note?: string; source: CouncilSource }
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
		return await env.DB.transaction(async (tx): Promise<RejectResult> => {
			const lyric = await tx
				.prepare("SELECT committee_approved_at FROM lyrics WHERE id = ? FOR UPDATE")
				.bind(lyricsId)
				.first<{ committee_approved_at: number | null }>()
			if (lyric?.committee_approved_at != null) {
				return { ok: false, reason: "sealed" }
			}
			const row = await tx
				.prepare(
					"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at, note) VALUES (?, ?, ?, ?) RETURNING id"
				)
				.bind(lyricsId, userId, now, opts.note ?? null)
				.first<{ id: number | string }>()
			await recordCouncilEvent(tx, {
				actorId: userId,
				kind: "reject",
				source: opts.source,
				lyricsId,
				refId: Number(row?.id),
				note: opts.note ?? null,
				at: now,
			})
			await releaseBookmarksForItem(tx, "seal", lyricsId)
			return { ok: true, rejectionId: Number(row?.id) }
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return { ok: false, reason: "already_rejected" }
		}
		throw err
	}
}

export async function undoRejection(
	env: Env,
	lyricsId: number,
	userId: number,
	source: CouncilSource,
	rejectionId: number | null
): Promise<UndoRejectResult> {
	if (!(await isCommittee(env, userId))) {
		return { ok: false, reason: "not_committee" }
	}

	const now = Math.floor(Date.now() / 1000)
	return env.DB.transaction(async (tx): Promise<UndoRejectResult> => {
		// An unnamed undo after an edit lapse could hit a newer rejection than the one the caller saw.
		const revoked = await tx
			.prepare(
				`UPDATE rejections SET revoked_at = ?, revoke_reason = 'undo'
				 WHERE lyrics_id = ? AND revoked_at IS NULL
				   AND (id = ? OR (?::int IS NULL AND NOT EXISTS (
				     SELECT 1 FROM rejections lapsed WHERE lapsed.lyrics_id = ? AND lapsed.revoke_reason = 'edited')))
				 RETURNING id`
			)
			.bind(now, lyricsId, rejectionId, rejectionId, lyricsId)
			.first<{ id: number | string }>()
		if (!revoked) {
			return { ok: false, reason: "not_found" }
		}
		await recordCouncilEvent(tx, {
			actorId: userId,
			kind: "unreject",
			source,
			lyricsId,
			refId: Number(revoked.id),
			at: now,
		})
		return { ok: true }
	})
}

// Changed lyrics deserve a fresh look, so this is not a council undo and logs no event.
export async function lapseRejectionForEdit(tx: D1Compat, lyricsId: number): Promise<void> {
	await tx
		.prepare(
			"UPDATE rejections SET revoked_at = ?, revoke_reason = 'edited' WHERE lyrics_id = ? AND revoked_at IS NULL"
		)
		.bind(Math.floor(Date.now() / 1000), lyricsId)
		.run()
}
