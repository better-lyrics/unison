import type { D1Compat } from "@/infra/database"
import type {
	LyricsFormat,
	PendingReason,
	RevisionAuthor,
	RevisionBar,
	RevisionStatus,
	RevisionSummary,
	SyncType,
} from "@/types"
import { compress, decompressIfNeeded, isCompressed } from "@/utils/compression"
import { extractPlainText } from "@/utils/extract-text"
import { sha256Hex } from "@/utils/hash"
import { generatePetName } from "@/utils/petname"

export interface RevisionRow {
	id: number
	lyrics_id: number
	rev_no: number
	lyrics: string
	format: LyricsFormat
	sync_type: SyncType
	language: string | null
	isrc: string | null
	content_hash: string
	author_id: number | null
	status: RevisionStatus
	pending_reason: PendingReason | null
	text_drift: number
	timing_drift: number
	jev_probability: number | null
	reverts_revision_id: number | null
	reviewed_by: number | null
	reviewed_at: number | null
	review_note: string | null
	created_at: number
}

export interface LyricRevisionState {
	id: number
	song: string
	artist: string
	submitter_id: number | null
	deleted_at: number | null
	committee_approved_at: number | null
	current_revision_id: number | null
	anchor_revision_id: number | null
}

export interface NewRevision {
	lyricsId: number
	content: string
	format: LyricsFormat
	syncType: SyncType
	language: string | null
	isrc: string | null
	authorId: number
	status: "live" | "pending"
	pendingReason: PendingReason | null
	textDrift: number
	timingDrift: number
	jevProbability: number | null
	revertsRevisionId: number | null
}

export interface PendingRevisionRow {
	id: number
	lyrics_id: number
	rev_no: number
	lyrics: string
	format: LyricsFormat
	pending_reason: PendingReason
	jev_probability: number | null
	text_drift: number
	timing_drift: number
	created_at: number
	video_id: string
	song: string
	artist: string
	live_rev_no: number
	live_lyrics: string
	live_format: LyricsFormat
	author_key_id: string | null
	author_nickname: string | null
}

export async function loadLyricState(
	db: D1Compat,
	lyricsId: number,
	lock: boolean
): Promise<LyricRevisionState | null> {
	return db
		.prepare(
			`SELECT id, song, artist, submitter_id, deleted_at,
				committee_approved_at, current_revision_id, anchor_revision_id
			FROM lyrics WHERE id = ?${lock ? " FOR UPDATE" : ""}`
		)
		.bind(lyricsId)
		.first<LyricRevisionState>()
}

export async function ensureBaseRevision(db: D1Compat, lyricsId: number): Promise<void> {
	await db.transaction(async (tx) => {
		const lyric = await tx
			.prepare(
				`SELECT lyrics, format, sync_type, language, isrc, submitter_id, created_at,
					current_revision_id
				FROM lyrics WHERE id = ? FOR UPDATE`
			)
			.bind(lyricsId)
			.first<{
				lyrics: string
				format: LyricsFormat
				sync_type: SyncType
				language: string | null
				isrc: string | null
				submitter_id: number | null
				created_at: number
				current_revision_id: number | null
			}>()
		if (!lyric || lyric.current_revision_id !== null) return

		const content = await decompressIfNeeded(lyric.lyrics)
		const stored = isCompressed(lyric.lyrics) ? lyric.lyrics : await compress(content)
		const revision = await tx
			.prepare(
				`INSERT INTO lyric_revisions
					(lyrics_id, rev_no, lyrics, format, sync_type, language, isrc, content_hash,
					 author_id, status, created_at)
				VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'live', ?)
				RETURNING id`
			)
			.bind(
				lyricsId,
				stored,
				lyric.format,
				lyric.sync_type,
				lyric.language,
				lyric.isrc,
				sha256Hex(content),
				lyric.submitter_id,
				lyric.created_at
			)
			.first<{ id: number }>()
		await tx
			.prepare("UPDATE lyrics SET current_revision_id = ?, anchor_revision_id = ? WHERE id = ?")
			.bind(revision!.id, revision!.id, lyricsId)
			.run()
	})
}

export async function getRevisionRow(
	db: D1Compat,
	lyricsId: number,
	revisionId: number
): Promise<RevisionRow | null> {
	return db
		.prepare("SELECT * FROM lyric_revisions WHERE id = ? AND lyrics_id = ?")
		.bind(revisionId, lyricsId)
		.first<RevisionRow>()
}

export async function getPendingRevisionRow(
	db: D1Compat,
	lyricsId: number
): Promise<RevisionRow | null> {
	return db
		.prepare("SELECT * FROM lyric_revisions WHERE lyrics_id = ? AND status = 'pending'")
		.bind(lyricsId)
		.first<RevisionRow>()
}

export async function getPreviouslyLiveRow(
	db: D1Compat,
	lyricsId: number,
	beforeRevNo: number
): Promise<RevisionRow | null> {
	return db
		.prepare(
			`SELECT * FROM lyric_revisions
			WHERE lyrics_id = ? AND rev_no < ? AND status IN ('live', 'past')
			ORDER BY rev_no DESC LIMIT 1`
		)
		.bind(lyricsId, beforeRevNo)
		.first<RevisionRow>()
}

// Serializes one author's saves across lyrics so the per-user daily limit holds.
export async function lockRevisionAuthor(tx: D1Compat, authorId: number): Promise<void> {
	await tx
		.prepare("SELECT pg_advisory_xact_lock(hashtext(?))")
		.bind(`lyric-revisions:author:${authorId}`)
		.run()
}

export async function countRecentRevisions(
	db: D1Compat,
	lyricsId: number,
	authorId: number,
	since: number
): Promise<{ lyric: number; user: number }> {
	const row = await db
		.prepare(
			`SELECT
				(COUNT(*) FILTER (WHERE lyrics_id = ?))::INTEGER AS lyric_count,
				(COUNT(*) FILTER (WHERE author_id = ?))::INTEGER AS user_count
			FROM lyric_revisions
			WHERE rev_no > 1 AND created_at > ? AND (lyrics_id = ? OR author_id = ?)`
		)
		.bind(lyricsId, authorId, since, lyricsId, authorId)
		.first<{ lyric_count: number; user_count: number }>()
	return { lyric: row?.lyric_count ?? 0, user: row?.user_count ?? 0 }
}

export async function supersedePending(tx: D1Compat, lyricsId: number): Promise<void> {
	await tx
		.prepare(
			"UPDATE lyric_revisions SET status = 'superseded' WHERE lyrics_id = ? AND status = 'pending'"
		)
		.bind(lyricsId)
		.run()
}

export async function retireLiveRevision(tx: D1Compat, lyricsId: number): Promise<void> {
	await tx
		.prepare("UPDATE lyric_revisions SET status = 'past' WHERE lyrics_id = ? AND status = 'live'")
		.bind(lyricsId)
		.run()
}

export async function insertRevision(tx: D1Compat, input: NewRevision): Promise<RevisionRow> {
	const row = await tx
		.prepare(
			`INSERT INTO lyric_revisions
				(lyrics_id, rev_no, lyrics, format, sync_type, language, isrc, content_hash, author_id,
				 status, pending_reason, text_drift, timing_drift, jev_probability, reverts_revision_id)
			VALUES (
				?, (SELECT COALESCE(MAX(rev_no), 0) + 1 FROM lyric_revisions WHERE lyrics_id = ?),
				?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			)
			RETURNING *`
		)
		.bind(
			input.lyricsId,
			input.lyricsId,
			await compress(input.content),
			input.format,
			input.syncType,
			input.language,
			input.isrc,
			sha256Hex(input.content),
			input.authorId,
			input.status,
			input.pendingReason,
			input.textDrift,
			input.timingDrift,
			input.jevProbability,
			input.revertsRevisionId
		)
		.first<RevisionRow>()
	return row!
}

// The only writer of the lyrics content columns once a lyric has revisions.
export async function setCurrentRevision(tx: D1Compat, revision: RevisionRow): Promise<void> {
	const content = await decompressIfNeeded(revision.lyrics)
	await tx
		.prepare(
			`UPDATE lyrics SET
				lyrics = ?,
				format = ?,
				sync_type = ?,
				isrc = ?,
				language_source = CASE WHEN language IS NOT DISTINCT FROM ? THEN language_source ELSE 'submitter' END,
				language_detector_version = CASE WHEN language IS NOT DISTINCT FROM ? THEN language_detector_version ELSE NULL END,
				language = ?,
				lyrics_text_search = to_tsvector('simple', ?),
				current_revision_id = ?,
				updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?`
		)
		.bind(
			revision.lyrics,
			revision.format,
			revision.sync_type,
			revision.isrc,
			revision.language,
			revision.language,
			revision.language,
			extractPlainText(content, revision.format),
			revision.id,
			revision.lyrics_id
		)
		.run()
}

export async function setAnchorRevision(
	tx: D1Compat,
	lyricsId: number,
	revisionId: number
): Promise<void> {
	await tx
		.prepare("UPDATE lyrics SET anchor_revision_id = ? WHERE id = ?")
		.bind(revisionId, lyricsId)
		.run()
}

export async function setRevisionStatus(
	tx: D1Compat,
	revisionId: number,
	status: RevisionStatus
): Promise<void> {
	await tx
		.prepare("UPDATE lyric_revisions SET status = ? WHERE id = ?")
		.bind(status, revisionId)
		.run()
}

export async function recordReview(
	tx: D1Compat,
	revisionId: number,
	status: "live" | "rejected",
	reviewerId: number,
	note: string | null
): Promise<void> {
	await tx
		.prepare(
			`UPDATE lyric_revisions
			SET status = ?, reviewed_by = ?, review_note = ?,
				reviewed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?`
		)
		.bind(status, reviewerId, note, revisionId)
		.run()
}

export function revisionAuthor(
	keyId: string | null,
	nickname: string | null
): RevisionAuthor | null {
	return keyId ? { displayName: nickname ?? generatePetName(keyId) } : null
}

interface SummaryRow {
	id: number
	rev_no: number
	status: RevisionStatus
	pending_reason: PendingReason | null
	text_drift: number
	timing_drift: number
	review_note: string | null
	created_at: number
	reviewed_at: number | null
	is_anchor: boolean | null
	reverts_rev_no: number | null
	author_key_id: string | null
	author_nickname: string | null
}

const SUMMARY_SELECT = `
	SELECT r.id, r.rev_no, r.status, r.pending_reason, r.text_drift, r.timing_drift,
		r.review_note, r.created_at, r.reviewed_at, (r.id = l.anchor_revision_id) AS is_anchor,
		reverted.rev_no AS reverts_rev_no, u.key_id AS author_key_id, u.nickname AS author_nickname
	FROM lyric_revisions r
	JOIN lyrics l ON l.id = r.lyrics_id
	LEFT JOIN lyric_revisions reverted ON reverted.id = r.reverts_revision_id
	LEFT JOIN users u ON u.id = r.author_id
`

function toSummary(row: SummaryRow): RevisionSummary {
	return {
		id: row.id,
		revNo: row.rev_no,
		status: row.status,
		pendingReason: row.pending_reason,
		isAnchor: row.is_anchor === true,
		textDrift: row.text_drift,
		timingDrift: row.timing_drift,
		revertsRevNo: row.reverts_rev_no,
		author: revisionAuthor(row.author_key_id, row.author_nickname),
		reviewNote: row.review_note,
		createdAt: row.created_at,
		reviewedAt: row.reviewed_at,
	}
}

export async function listRevisionSummaries(
	db: D1Compat,
	lyricsId: number
): Promise<RevisionSummary[]> {
	const { results } = await db
		.prepare(`${SUMMARY_SELECT} WHERE r.lyrics_id = ? ORDER BY r.rev_no DESC`)
		.bind(lyricsId)
		.all<SummaryRow>()
	return results.map(toSummary)
}

export async function getRevisionSummary(
	db: D1Compat,
	lyricsId: number,
	revisionId: number
): Promise<RevisionSummary | null> {
	const row = await db
		.prepare(`${SUMMARY_SELECT} WHERE r.lyrics_id = ? AND r.id = ?`)
		.bind(lyricsId, revisionId)
		.first<SummaryRow>()
	return row ? toSummary(row) : null
}

export async function getRevisionBar(
	db: D1Compat,
	lyric: { id: number; created_at: number }
): Promise<RevisionBar> {
	const row = await db
		.prepare(
			`SELECT live.rev_no, live.created_at AS updated_at,
				(SELECT COUNT(*)::INTEGER FROM lyric_revisions WHERE lyrics_id = l.id) AS count,
				pending.rev_no AS pending_rev_no, pending.pending_reason,
				pending.text_drift AS pending_text_drift, pending.timing_drift AS pending_timing_drift,
				rejected.rev_no AS rejected_rev_no, rejected.review_note
			FROM lyrics l
			JOIN lyric_revisions live ON live.id = l.current_revision_id
			LEFT JOIN lyric_revisions pending ON pending.lyrics_id = l.id AND pending.status = 'pending'
			LEFT JOIN LATERAL (
				SELECT rev_no, review_note FROM lyric_revisions
				WHERE lyrics_id = l.id AND status = 'rejected' AND rev_no > live.rev_no
				ORDER BY rev_no DESC LIMIT 1
			) rejected ON TRUE
			WHERE l.id = ?`
		)
		.bind(lyric.id)
		.first<{
			rev_no: number
			updated_at: number
			count: number
			pending_rev_no: number | null
			pending_reason: PendingReason | null
			pending_text_drift: number | null
			pending_timing_drift: number | null
			rejected_rev_no: number | null
			review_note: string | null
		}>()
	if (!row) {
		return { revNo: 1, count: 1, pending: null, lastRejected: null, updatedAt: lyric.created_at }
	}
	return {
		revNo: row.rev_no,
		count: row.count,
		pending:
			row.pending_rev_no !== null && row.pending_reason !== null
				? {
						revNo: row.pending_rev_no,
						pendingReason: row.pending_reason,
						textDrift: row.pending_text_drift ?? 0,
						timingDrift: row.pending_timing_drift ?? 0,
					}
				: null,
		lastRejected:
			row.rejected_rev_no !== null
				? { revNo: row.rejected_rev_no, reviewNote: row.review_note }
				: null,
		updatedAt: row.updated_at,
	}
}

export async function listPendingRevisionRows(
	db: D1Compat,
	limit: number
): Promise<PendingRevisionRow[]> {
	const { results } = await db
		.prepare(
			`SELECT r.id, r.lyrics_id, r.rev_no, r.lyrics, r.format, r.pending_reason,
				r.jev_probability, r.text_drift, r.timing_drift, r.created_at,
				l.video_id, l.song, l.artist,
				live.rev_no AS live_rev_no, live.lyrics AS live_lyrics, live.format AS live_format,
				u.key_id AS author_key_id, u.nickname AS author_nickname
			FROM lyric_revisions r
			JOIN lyrics l ON l.id = r.lyrics_id AND l.deleted_at IS NULL
			JOIN lyric_revisions live ON live.id = l.current_revision_id
			LEFT JOIN users u ON u.id = r.author_id
			WHERE r.status = 'pending'
			ORDER BY r.created_at ASC, r.id ASC
			LIMIT ?`
		)
		.bind(limit)
		.all<PendingRevisionRow>()
	return results
}
