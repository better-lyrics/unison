import { config } from "@/config"
import { AVATAR_COLUMNS, AVATAR_JOINS, type AvatarRow, avatarUrlForRow } from "@/db/avatar-join"
import { bannedUserPredicate, videoServesExpr } from "@/db/predicates"
import { lapseRejectionForEdit } from "@/db/rejections"
import { type D1Compat, advisoryXactLock } from "@/infra/database"
import { Logger } from "@/infra/logger"
import type {
	LyricsFormat,
	PendingReason,
	RevisionAuthor,
	RevisionBar,
	RevisionStatus,
	RevisionSuggestion,
	RevisionSummary,
	SuggestionInboxItem,
	SyncType,
} from "@/types"
import { compress, decompressIfNeeded, isCompressed } from "@/utils/compression"
import { type LyricLine, extractComparableLines, extractPlainText } from "@/utils/extract-text"
import { sha256Hex } from "@/utils/hash"
import { showsChanges } from "@/utils/lyric-diff"
import { lyricFingerprint } from "@/utils/lyric-fingerprint"
import {
	councilDecidesAt,
	ownerWindowOpenSql,
	ownerlessSql,
	patchSql,
	waitingSuggestionSql,
} from "@/utils/lyric-patch"
import { normalizeAlbum } from "@/utils/normalize"
import { generatePetName } from "@/utils/petname"

const log = new Logger("revisions")

export interface RevisionRow {
	id: number
	lyrics_id: number
	rev_no: number
	lyrics: string
	format: LyricsFormat
	sync_type: SyncType
	language: string | null
	isrc: string | null
	album: string | null
	album_known: boolean
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
	album: string | null
	submitter_id: number | null
	ownerless: boolean
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
	album: string | null
	authorId: number
	status: "live" | "pending"
	pendingReason: PendingReason | null
	textDrift: number
	timingDrift: number
	jevProbability: number | null
	revertsRevisionId: number | null
	authorNote?: string | null
}

export interface PendingRevisionRow {
	id: number
	lyrics_id: number
	rev_no: number
	lyrics: string
	format: LyricsFormat
	pending_reason: PendingReason
	language: string | null
	isrc: string | null
	album: string | null
	album_known: boolean
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
	live_language: string | null
	live_isrc: string | null
	lyric_album: string | null
	author_key_id: string | null
	author_nickname: string | null
	suggestion: boolean
	ownerless: boolean
	author_note: string | null
}

export async function loadLyricState(
	db: D1Compat,
	lyricsId: number,
	lock: boolean
): Promise<LyricRevisionState | null> {
	return db
		.prepare(
			`SELECT l.id, l.song, l.artist, l.album, l.submitter_id, ${ownerlessSql("l")} AS ownerless,
				l.deleted_at, l.committee_approved_at, l.current_revision_id, l.anchor_revision_id
			FROM lyrics l WHERE l.id = ?${lock ? " FOR UPDATE" : ""}`
		)
		.bind(lyricsId)
		.first<LyricRevisionState>()
}

export async function ensureBaseRevision(db: D1Compat, lyricsId: number): Promise<void> {
	await db.transaction(async (tx) => {
		const lyric = await tx
			.prepare(
				`SELECT lyrics, format, sync_type, language, isrc, album, submitter_id, created_at,
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
				album: string | null
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
					(lyrics_id, rev_no, lyrics, format, sync_type, language, isrc, album, album_known,
					 content_hash, author_id, status, created_at)
				VALUES (?, 1, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, 'live', ?)
				RETURNING id`
			)
			.bind(
				lyricsId,
				stored,
				lyric.format,
				lyric.sync_type,
				lyric.language,
				lyric.isrc,
				lyric.album,
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
	await advisoryXactLock(tx, `lyric-revisions:author:${authorId}`)
}

export async function countRecentRevisions(
	db: D1Compat,
	lyricsId: number,
	authorId: number,
	patch: boolean,
	since: number
): Promise<{ lyric: number; user: number }> {
	const row = await db
		.prepare(
			`SELECT
				(COUNT(*) FILTER (
					WHERE r.lyrics_id = ? AND (${patchSql("r", "l")}) = ?
						AND (NOT ${patchSql("r", "l")} OR r.author_id = ?)
				))::INTEGER AS lyric_count,
				(COUNT(*) FILTER (WHERE r.author_id = ?))::INTEGER AS user_count
			FROM lyric_revisions r
			JOIN lyrics l ON l.id = r.lyrics_id
			WHERE r.rev_no > 1 AND r.created_at > ? AND (r.lyrics_id = ? OR r.author_id = ?)`
		)
		.bind(lyricsId, patch, authorId, authorId, since, lyricsId, authorId)
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

export interface WithdrawnSuggestion {
	id: number
	albumInherited: boolean | null
}

export async function withdrawOwnSuggestions(
	tx: D1Compat,
	userId: number
): Promise<WithdrawnSuggestion[]> {
	const rows = await tx
		.prepare(
			`UPDATE lyric_revisions r SET status = 'withdrawn' FROM lyrics l
			 WHERE l.id = r.lyrics_id AND r.author_id = ? AND r.status = 'pending'
				AND r.pending_reason = 'suggested' AND NOT ${patchSql("r", "l")}
			 RETURNING r.id, (r.album_known AND r.album IS NOT DISTINCT FROM l.album) AS album_inherited`
		)
		.bind(userId)
		.all<{ id: number; album_inherited: boolean }>()
	return rows.results.map((r) => ({ id: Number(r.id), albumInherited: r.album_inherited }))
}

export async function restoreWithdrawnSuggestion(
	tx: D1Compat,
	{ id, albumInherited }: WithdrawnSuggestion
): Promise<boolean> {
	const revision = await tx
		.prepare("SELECT lyrics_id FROM lyric_revisions WHERE id = ?")
		.bind(id)
		.first<{ lyrics_id: number }>()
	if (!revision) return false
	await tx.prepare("SELECT id FROM lyrics WHERE id = ? FOR UPDATE").bind(revision.lyrics_id).run()
	const restored = await tx
		.prepare(
			`UPDATE lyric_revisions r SET status = 'pending',
				album = CASE WHEN ?::boolean THEN l.album ELSE r.album END
			 FROM lyrics l
			 WHERE r.id = ? AND l.id = r.lyrics_id AND r.status = 'withdrawn'
				AND (?::boolean IS NOT NULL OR NOT r.album_known OR r.album IS NOT DISTINCT FROM l.album)
				AND NOT EXISTS (
					SELECT 1 FROM lyric_revisions p WHERE p.lyrics_id = l.id AND p.status = 'pending'
				)
			 RETURNING r.id`
		)
		.bind(albumInherited, id, albumInherited)
		.first<{ id: number }>()
	return restored !== null
}

export async function withdrawPendingSuggestionsBy(tx: D1Compat, authorId: number): Promise<void> {
	await tx
		.prepare(
			`UPDATE lyric_revisions r SET status = 'withdrawn' FROM lyrics l
			 WHERE l.id = r.lyrics_id AND r.author_id = ? AND r.status = 'pending'
				AND ${patchSql("r", "l")}`
		)
		.bind(authorId)
		.run()
}

export async function carryPendingAlbums(
	tx: D1Compat,
	videoId: string,
	album: string | null
): Promise<void> {
	await tx
		.prepare(
			`UPDATE lyric_revisions r SET album = ?::text FROM lyrics l
			 WHERE l.id = r.lyrics_id AND r.status = 'pending' AND r.album_known
				AND r.album IS NOT DISTINCT FROM l.album AND l.album IS DISTINCT FROM ?::text
				AND ${videoServesExpr("l.")}`
		)
		.bind(album, album, videoId, videoId)
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
				(lyrics_id, rev_no, lyrics, format, sync_type, language, isrc, album, album_known,
				 content_hash, author_id, status, pending_reason, text_drift, timing_drift,
				 jev_probability, reverts_revision_id, author_note)
			VALUES (
				?, (SELECT COALESCE(MAX(rev_no), 0) + 1 FROM lyric_revisions WHERE lyrics_id = ?),
				?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
			input.album,
			sha256Hex(input.content),
			input.authorId,
			input.status,
			input.pendingReason,
			input.textDrift,
			input.timingDrift,
			input.jevProbability,
			input.revertsRevisionId,
			input.authorNote ?? null
		)
		.first<RevisionRow>()
	return row!
}

export async function revisionLines(stored: string, format: LyricsFormat): Promise<LyricLine[]> {
	try {
		return extractComparableLines(await decompressIfNeeded(stored), format)
	} catch (err) {
		log.warn("stored revision content could not be parsed", { error: (err as Error).message })
		return []
	}
}

export async function revisionFingerprint(
	stored: string,
	format: LyricsFormat
): Promise<string | null> {
	try {
		return lyricFingerprint(await decompressIfNeeded(stored), format)
	} catch (err) {
		log.warn("stored revision content could not be fingerprinted", {
			error: (err as Error).message,
		})
		return null
	}
}

async function changesLyrics(tx: D1Compat, revision: RevisionRow): Promise<boolean> {
	const replaced = await tx
		.prepare(
			`SELECT r.lyrics, r.format, r.content_hash FROM lyrics l
			JOIN lyric_revisions r ON r.id = l.current_revision_id
			WHERE l.id = ?`
		)
		.bind(revision.lyrics_id)
		.first<{ lyrics: string; format: LyricsFormat; content_hash: string }>()
	if (!replaced || replaced.content_hash === revision.content_hash) return false
	return showsChanges(
		await revisionLines(replaced.lyrics, replaced.format),
		await revisionLines(revision.lyrics, revision.format)
	)
}

// With restoreLyricContent, the only writer of the lyrics content columns once a lyric has revisions.
export async function setCurrentRevision(tx: D1Compat, revision: RevisionRow): Promise<void> {
	if (await changesLyrics(tx, revision)) await lapseRejectionForEdit(tx, revision.lyrics_id)
	const content = await decompressIfNeeded(revision.lyrics)
	await tx
		.prepare(
			`UPDATE lyrics SET
				lyrics = ?,
				format = ?,
				sync_type = ?,
				isrc = ?,
				album = CASE WHEN ? THEN ? ELSE album END,
				album_norm = CASE WHEN ? THEN ? ELSE album_norm END,
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
			revision.album_known,
			revision.album,
			revision.album_known,
			normalizeAlbum(revision.album),
			revision.language,
			revision.language,
			revision.language,
			extractPlainText(content, revision.format),
			revision.id,
			revision.lyrics_id
		)
		.run()
}

export interface LyricContentSnapshot {
	lyrics: string
	format: LyricsFormat
	sync_type: SyncType
	lyrics_text_search: string | null
}

export async function snapshotLyricContent(
	db: D1Compat,
	lyricsId: number
): Promise<LyricContentSnapshot | null> {
	return db
		.prepare(
			`SELECT lyrics, format, sync_type, lyrics_text_search::text AS lyrics_text_search
			FROM lyrics WHERE id = ?`
		)
		.bind(lyricsId)
		.first<LyricContentSnapshot>()
}

export async function restoreLyricContent(
	tx: D1Compat,
	lyricsId: number,
	snapshot: LyricContentSnapshot,
	pointers: { currentRevisionId: number; anchorRevisionId: number }
): Promise<void> {
	await tx
		.prepare(
			`UPDATE lyrics SET
				lyrics = ?, format = ?, sync_type = ?, lyrics_text_search = ?::tsvector,
				current_revision_id = ?, anchor_revision_id = ?,
				updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?`
		)
		.bind(
			snapshot.lyrics,
			snapshot.format,
			snapshot.sync_type,
			snapshot.lyrics_text_search,
			pointers.currentRevisionId,
			pointers.anchorRevisionId,
			lyricsId
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
): Promise<boolean> {
	const row = await tx
		.prepare(
			`UPDATE lyric_revisions
			SET status = ?, reviewed_by = ?, review_note = ?,
				reviewed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ? AND status = 'pending'
			RETURNING id`
		)
		.bind(status, reviewerId, note, revisionId)
		.first<{ id: number }>()
	return row !== null
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
		pendingReason: row.pending_reason === "suggested" ? null : row.pending_reason,
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
		.prepare(
			`${SUMMARY_SELECT} WHERE r.lyrics_id = ?
				AND NOT ${waitingSuggestionSql("r", "l")}
			ORDER BY r.rev_no DESC`
		)
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

const SUGGESTION_COLUMNS = `suggestion.id AS suggestion_id, suggestion.rev_no AS suggestion_rev_no,
		suggestion.pending_reason AS suggestion_reason,
		suggestion.created_at AS suggestion_created_at,
		l.committee_approved_at IS NOT NULL AS suggestion_sealed,
		${ownerlessSql("l")} AS suggestion_ownerless,
		u.key_id AS suggestion_author_key_id, u.nickname AS suggestion_author_nickname,
		suggestion.author_note AS suggestion_note, ${AVATAR_COLUMNS}`

const SUGGESTION_JOIN = `lyric_revisions suggestion
		ON suggestion.lyrics_id = l.id AND suggestion.status = 'pending'
			AND ${patchSql("suggestion", "l")} AND NOT ${bannedUserPredicate("suggestion.author_id")}
	LEFT JOIN users u ON u.id = suggestion.author_id
	${AVATAR_JOINS}`

interface SuggestionColumns extends AvatarRow {
	suggestion_id: number | null
	suggestion_rev_no: number | null
	suggestion_reason: PendingReason | null
	suggestion_created_at: number | null
	suggestion_sealed: boolean
	suggestion_ownerless: boolean
	suggestion_author_key_id: string | null
	suggestion_author_nickname: string | null
	suggestion_note: string | null
}

function toSuggestion(row: SuggestionColumns): RevisionSuggestion | null {
	if (
		row.suggestion_id == null ||
		row.suggestion_rev_no == null ||
		row.suggestion_reason == null ||
		row.suggestion_created_at == null
	) {
		return null
	}
	return {
		id: row.suggestion_id,
		revNo: row.suggestion_rev_no,
		author: revisionAuthor(row.suggestion_author_key_id, row.suggestion_author_nickname),
		authorKeyId: row.suggestion_author_key_id,
		authorAvatarUrl: avatarUrlForRow(row),
		pendingReason: row.suggestion_reason,
		sealed: row.suggestion_sealed,
		createdAt: row.suggestion_created_at,
		councilDecidesAt: councilDecidesAt(
			row.suggestion_reason,
			row.suggestion_sealed,
			row.suggestion_ownerless,
			row.suggestion_created_at,
			Math.floor(Date.now() / 1000)
		),
		note: row.suggestion_note,
		rejectNoteMaxLength: config.validation.report.maxDetailsLength,
	}
}

const REVISION_BAR_SELECT = `SELECT l.id AS lyrics_id, live.rev_no, live.created_at AS updated_at,
		(SELECT COUNT(*)::INTEGER FROM lyric_revisions c
			WHERE c.lyrics_id = l.id AND NOT ${waitingSuggestionSql("c", "l")}) AS count,
		pending.rev_no AS pending_rev_no, pending.pending_reason,
		pending.text_drift AS pending_text_drift, pending.timing_drift AS pending_timing_drift,
		rejected.rev_no AS rejected_rev_no, rejected.review_note, ${SUGGESTION_COLUMNS}
	FROM lyrics l
	JOIN lyric_revisions live ON live.id = l.current_revision_id
	LEFT JOIN lyric_revisions pending ON pending.lyrics_id = l.id AND pending.status = 'pending'
		AND NOT (${patchSql("pending", "l")})
	LEFT JOIN ${SUGGESTION_JOIN}
	LEFT JOIN LATERAL (
		SELECT r.rev_no, r.review_note FROM lyric_revisions r
		WHERE r.lyrics_id = l.id AND r.status = 'rejected' AND r.rev_no > live.rev_no
			AND NOT ${patchSql("r", "l")}
		ORDER BY r.rev_no DESC LIMIT 1
	) rejected ON TRUE`

interface RevisionBarRow extends SuggestionColumns {
	lyrics_id: number
	rev_no: number
	updated_at: number
	count: number
	pending_rev_no: number | null
	pending_reason: PendingReason | null
	pending_text_drift: number | null
	pending_timing_drift: number | null
	rejected_rev_no: number | null
	review_note: string | null
}

function toRevisionBar(row: RevisionBarRow | null | undefined, createdAt: number): RevisionBar {
	if (!row) {
		return { revNo: 1, count: 1, pending: null, lastRejected: null, updatedAt: createdAt }
	}
	const suggestion = toSuggestion(row)
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
		...(suggestion ? { suggestion } : {}),
	}
}

export async function getRevisionBar(
	db: D1Compat,
	lyric: { id: number; created_at: number }
): Promise<RevisionBar> {
	const row = await db
		.prepare(`${REVISION_BAR_SELECT} WHERE l.id = ?`)
		.bind(lyric.id)
		.first<RevisionBarRow>()
	return toRevisionBar(row, lyric.created_at)
}

export async function getRevisionBars(
	db: D1Compat,
	lyrics: { id: number; created_at: number }[]
): Promise<Map<number, RevisionBar>> {
	if (lyrics.length === 0) return new Map()
	const { results } = await db
		.prepare(`${REVISION_BAR_SELECT} WHERE l.id = ANY(?)`)
		.bind(lyrics.map((lyric) => lyric.id))
		.all<RevisionBarRow>()
	const rowsById = new Map(results.map((row) => [Number(row.lyrics_id), row]))
	return new Map(
		lyrics.map((lyric) => [lyric.id, toRevisionBar(rowsById.get(lyric.id), lyric.created_at)])
	)
}

export async function listPendingRevisionRows(
	db: D1Compat,
	limit: number
): Promise<PendingRevisionRow[]> {
	const { results } = await db
		.prepare(
			`SELECT r.id, r.lyrics_id, r.rev_no, r.lyrics, r.format, r.pending_reason,
				r.language, r.isrc, r.album, r.album_known,
				r.jev_probability, r.text_drift, r.timing_drift, r.created_at,
				l.video_id, l.song, l.artist, l.album AS lyric_album,
				live.rev_no AS live_rev_no, live.lyrics AS live_lyrics, live.format AS live_format,
				live.language AS live_language, live.isrc AS live_isrc,
				u.key_id AS author_key_id, u.nickname AS author_nickname,
				${patchSql("r", "l")} AS suggestion, ${ownerlessSql("l")} AS ownerless, r.author_note
			FROM lyric_revisions r
			JOIN lyrics l ON l.id = r.lyrics_id AND l.deleted_at IS NULL
			JOIN lyric_revisions live ON live.id = l.current_revision_id
			LEFT JOIN users u ON u.id = r.author_id
			WHERE r.status = 'pending' AND NOT ${ownerWindowOpenSql("r", "l")}
				AND NOT (${patchSql("r", "l")} AND ${bannedUserPredicate("r.author_id")})
			ORDER BY r.created_at ASC, r.id ASC
			LIMIT ?`
		)
		.bind(limit)
		.all<PendingRevisionRow>()
	return results
}

interface SuggestionInboxRow extends SuggestionColumns {
	lyrics_id: number
	video_id: string
	song: string
	artist: string
}

export async function listSuggestionsForOwner(
	db: D1Compat,
	ownerId: number,
	limit: number
): Promise<SuggestionInboxItem[]> {
	const { results } = await db
		.prepare(
			`SELECT l.id AS lyrics_id, l.video_id, l.song, l.artist, ${SUGGESTION_COLUMNS}
			FROM lyrics l
			JOIN ${SUGGESTION_JOIN}
			WHERE l.submitter_id = ? AND l.deleted_at IS NULL
			ORDER BY suggestion.created_at DESC, suggestion.id DESC
			LIMIT ?`
		)
		.bind(ownerId, limit)
		.all<SuggestionInboxRow>()
	return results.flatMap((row) => {
		const suggestion = toSuggestion(row)
		return suggestion
			? [
					{
						lyricsId: row.lyrics_id,
						videoId: row.video_id,
						song: row.song,
						artist: row.artist,
						suggestion,
					},
				]
			: []
	})
}
