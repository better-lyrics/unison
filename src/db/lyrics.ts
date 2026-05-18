import { config } from "@/config"
import { Logger } from "@/infra/logger"
import type { Env, LyricsRow, LyricsSearchResult, LyricsSubmission } from "@/types"
import { compress, decompress, isCompressed } from "@/utils/compression"
import { extractPlainText } from "@/utils/extract-text"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"

const log = new Logger("db")
const cacheLog = new Logger("cache")

// Composite ranking: community confidence + recency boost + sync quality
// - effective_score × ln(vote_count + base): amplifies scores backed by more votes
// - recencyWeight / (1 + age_days): surfaces new entries, decays within days
// - sync_type multiplier: richsync > linesync > plain
const { syncTypeBoost } = config.ranking
const buildRankingExpr = (prefix: string) => {
	const syncTypeBoostExpr = `CASE ${prefix}sync_type
		WHEN 'richsync' THEN ${syncTypeBoost.richsync}
		WHEN 'linesync' THEN ${syncTypeBoost.linesync}
		ELSE ${syncTypeBoost.plain}
	END`
	return `(
		(${prefix}effective_score * LN(${prefix}vote_count + ${config.ranking.confidenceBase})
		+ ${config.ranking.recencyWeight} / (1.0 + (EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at) / 86400.0))
		* ${syncTypeBoostExpr}
	)`
}

export const RANKING_EXPR = buildRankingExpr("")
const RANKING_EXPR_JOINED = buildRankingExpr("l.")

const { autoHide } = config.moderation

const buildAutoHidePredicate = (prefix: string) => `(
	(
		${prefix}vote_count >= ${autoHide.minVotes}
		AND ${prefix}downvotes >= ${autoHide.downvoteRatio} * ${prefix}vote_count
		AND ${prefix}effective_score < ${autoHide.maxEffectiveScore}
	)
	OR
	(
		${prefix}vote_count >= ${autoHide.decisiveMinVotes}
		AND ${prefix}downvotes = ${prefix}vote_count
		AND EXTRACT(EPOCH FROM NOW())::INTEGER - ${prefix}created_at >= ${autoHide.decisiveMinAgeDays * 86400}
	)
)`

export const AUTO_HIDE_PREDICATE = buildAutoHidePredicate("")
const AUTO_HIDE_PREDICATE_JOINED = buildAutoHidePredicate("l.")

const LYRICS_WITH_SUBMITTER = `
	SELECT l.*, u.key_id AS submitter_key_id, u.reputation AS submitter_reputation,
		${AUTO_HIDE_PREDICATE_JOINED} AS hidden
	FROM lyrics l
	LEFT JOIN users u ON l.submitter_id = u.id
`

export async function findByVideoId(env: Env, videoId: string): Promise<LyricsRow | null> {
	const cached = await env.CACHE.get(`v:${videoId}`)
	if (cached) {
		try {
			const row = JSON.parse(cached) as LyricsRow
			if (isCompressed(row.lyrics)) {
				row.lyrics = await decompress(row.lyrics)
			}
			cacheLog.debug("hit", { key: `v:${videoId}` })
			return row
		} catch {
			cacheLog.warn("corrupt entry, evicting", { key: `v:${videoId}` })
			await env.CACHE.delete(`v:${videoId}`)
		}
	}

	cacheLog.debug("miss", { key: `v:${videoId}` })
	const result = await env.DB.prepare(
		`${LYRICS_WITH_SUBMITTER} WHERE l.video_id = ? AND l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED} ORDER BY ${RANKING_EXPR_JOINED} DESC LIMIT 1`
	)
		.bind(videoId)
		.first<LyricsRow>()

	if (result) {
		if (isCompressed(result.lyrics)) {
			result.lyrics = await decompress(result.lyrics)
		}
		await cacheResult(env, result)
		log.debug("found by videoId", { videoId, id: result.id })
	} else {
		log.debug("not found by videoId", { videoId })
	}

	return result
}

export async function findVariantsByVideoId(
	env: Env,
	videoId: string,
	limit: number
): Promise<LyricsRow[]> {
	const results = await env.DB.prepare(
		`
		${LYRICS_WITH_SUBMITTER}
		WHERE l.video_id = ? AND l.deleted_at IS NULL
		ORDER BY ${RANKING_EXPR_JOINED} DESC
		LIMIT ?
		`
	)
		.bind(videoId, limit)
		.all<LyricsRow>()

	for (const row of results.results) {
		if (isCompressed(row.lyrics)) {
			row.lyrics = await decompress(row.lyrics)
		}
	}

	return results.results
}

export async function findBySongArtist(
	env: Env,
	song: string,
	artist: string,
	duration?: number,
	album?: string
): Promise<LyricsRow | null> {
	const songNorm = normalizeSong(song)
	const artistNorm = normalizeArtist(artist)

	const conditions = [
		"l.song_norm = ?",
		"l.artist_norm = ?",
		"l.deleted_at IS NULL",
		`NOT ${AUTO_HIDE_PREDICATE_JOINED}`,
	]
	const params: (string | number)[] = [songNorm, artistNorm]

	if (duration !== undefined) {
		conditions.push("ABS(l.duration - ?) <= ?")
		params.push(duration, config.matching.durationTolerance)
	}

	if (album) {
		conditions.push("l.album = ?")
		params.push(album.trim())
	}

	const query = `
		${LYRICS_WITH_SUBMITTER}
		WHERE ${conditions.join(" AND ")}
		ORDER BY ${RANKING_EXPR_JOINED} DESC
		LIMIT 1
	`

	const result = await env.DB.prepare(query)
		.bind(...params)
		.first<LyricsRow>()

	if (result) {
		if (isCompressed(result.lyrics)) {
			result.lyrics = await decompress(result.lyrics)
		}
	}

	return result
}

export async function submitLyrics(
	env: Env,
	submission: LyricsSubmission,
	submitterId: number
): Promise<{ id: number; created: boolean }> {
	const compressedLyrics = await compress(submission.lyrics)
	const plainText = extractPlainText(submission.lyrics, submission.format)
	const songNorm = normalizeSong(submission.song)
	const artistNorm = normalizeArtist(submission.artist)
	const albumNorm = submission.album ? normalize(submission.album) : null

	// Check per-user-per-video variant cap
	const variantCount = await env.DB.prepare(
		"SELECT COUNT(*)::INTEGER AS count FROM lyrics WHERE video_id = ? AND submitter_id = ? AND deleted_at IS NULL"
	)
		.bind(submission.videoId, submitterId)
		.first<{ count: number }>()

	if (variantCount && variantCount.count >= config.submission.maxVariantsPerUserPerVideo) {
		log.info("variant cap reached", {
			videoId: submission.videoId,
			submitter_id: submitterId,
			count: variantCount.count,
		})
		return { id: -1, created: false }
	}

	const result = await env.DB.prepare(
		`
		INSERT INTO lyrics (
			video_id, song, artist, album, isrc,
			duration, song_norm, artist_norm, album_norm,
			lyrics, format, language, sync_type, submitter_id,
			lyrics_text_search
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_tsvector('simple', ?))
		RETURNING id
		`
	)
		.bind(
			submission.videoId,
			submission.song.trim(),
			submission.artist.trim(),
			submission.album?.trim() || null,
			submission.isrc || null,
			submission.duration,
			songNorm,
			artistNorm,
			albumNorm,
			compressedLyrics,
			submission.format,
			submission.language || null,
			submission.syncType,
			submitterId,
			plainText
		)
		.first<{ id: number }>()

	log.info("new lyrics submitted", {
		videoId: submission.videoId,
		id: result!.id,
		format: submission.format,
		sync_type: submission.syncType,
	})

	// Invalidate cache so the new variant competes in ranking
	await invalidateCache(env, submission.videoId)

	return { id: result!.id, created: true }
}

export async function searchBySongArtist(
	env: Env,
	song: string,
	artist: string,
	duration?: number,
	album?: string,
	limit = 20
): Promise<LyricsRow[]> {
	const songNorm = normalizeSong(song)
	const artistNorm = normalizeArtist(artist)

	const conditions = [
		"l.song_norm = ?",
		"l.artist_norm = ?",
		"l.deleted_at IS NULL",
		`NOT ${AUTO_HIDE_PREDICATE_JOINED}`,
	]
	const params: (string | number)[] = [songNorm, artistNorm]

	if (duration !== undefined) {
		conditions.push("ABS(l.duration - ?) <= ?")
		params.push(duration, config.matching.durationTolerance)
	}

	if (album) {
		conditions.push("l.album = ?")
		params.push(album.trim())
	}

	params.push(limit)

	const results = await env.DB.prepare(
		`
		${LYRICS_WITH_SUBMITTER}
		WHERE ${conditions.join(" AND ")}
		ORDER BY ${RANKING_EXPR_JOINED} DESC
		LIMIT ?
		`
	)
		.bind(...params)
		.all<LyricsRow>()

	for (const row of results.results) {
		if (isCompressed(row.lyrics)) {
			row.lyrics = await decompress(row.lyrics)
		}
	}

	return results.results
}

export async function getLyricsById(env: Env, id: number): Promise<LyricsRow | null> {
	const result = await env.DB.prepare(
		`${LYRICS_WITH_SUBMITTER} WHERE l.id = ? AND l.deleted_at IS NULL`
	)
		.bind(id)
		.first<LyricsRow>()

	if (result && isCompressed(result.lyrics)) {
		result.lyrics = await decompress(result.lyrics)
	}

	return result
}

async function cacheResult(env: Env, result: LyricsRow): Promise<void> {
	const cacheTtl = Number.parseInt(env.CACHE_TTL_SECONDS) || config.cache.ttlSeconds
	const cacheData = { ...result, lyrics: await compress(result.lyrics) }
	await env.CACHE.put(`v:${result.video_id}`, JSON.stringify(cacheData), {
		expirationTtl: cacheTtl,
	})
}

export async function invalidateCache(env: Env, videoId: string): Promise<void> {
	await env.CACHE.delete(`v:${videoId}`)
}

export async function invalidateCacheAfterDelete(env: Env, videoId: string): Promise<void> {
	await env.CACHE.delete(`v:${videoId}`)
	const feedKeys = await env.CACHE.keys("feed:global:*")
	for (const key of feedKeys) {
		await env.CACHE.delete(key)
	}
}

export type SoftDeleteResult =
	| { deleted: true }
	| { deleted: false; reason: "not_found" | "forbidden" | "already_deleted" }

export async function softDeleteLyrics(
	env: Env,
	lyricsId: number,
	actingUserId: number,
	role: "submitter" | "admin",
	reason: string | null = null
): Promise<SoftDeleteResult> {
	const row = await env.DB.prepare(
		"SELECT id, video_id, submitter_id, deleted_at FROM lyrics WHERE id = ?"
	)
		.bind(lyricsId)
		.first<{ id: number; video_id: string; submitter_id: number; deleted_at: number | null }>()

	if (!row) return { deleted: false, reason: "not_found" }
	if (row.deleted_at !== null) return { deleted: false, reason: "already_deleted" }
	if (role === "submitter" && row.submitter_id !== actingUserId) {
		return { deleted: false, reason: "forbidden" }
	}

	await env.DB.prepare(
		`UPDATE lyrics SET
			deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
			deleted_by_user_id = ?,
			deleted_by_role = ?,
			deletion_reason = ?
		WHERE id = ? AND deleted_at IS NULL`
	)
		.bind(actingUserId, role, reason, lyricsId)
		.run()

	await invalidateCacheAfterDelete(env, row.video_id)
	log.info("lyrics deleted", { lyricsId, role, actingUserId, videoId: row.video_id })

	return { deleted: true }
}

const SEARCH_COLUMNS = `
	id, video_id, song, artist, album, isrc, duration,
	format, language, sync_type, score, effective_score,
	vote_count, confidence, created_at
`

export async function searchByQuery(
	env: Env,
	query: string,
	limit: number
): Promise<LyricsSearchResult[]> {
	const normalized = normalize(query)
	if (normalized.length < config.search.minQueryLength) {
		return []
	}

	const threshold = config.search.similarityThreshold

	// Tier 1: exact identifier match (video_id or isrc)
	// Tier 2: trigram similarity on song_norm, artist_norm, album_norm, and combined fields
	// Tier 3: full-text search on lyrics content
	const sql = `
		SELECT DISTINCT ON (id) * FROM (
			SELECT ${SEARCH_COLUMNS},
				1.0::DOUBLE PRECISION AS match_score,
				1 AS tier
			FROM lyrics
			WHERE (video_id = ? OR isrc = ?) AND deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE}

			UNION ALL

			SELECT ${SEARCH_COLUMNS},
				GREATEST(
					similarity(song_norm, ?),
					similarity(artist_norm, ?),
					COALESCE(similarity(album_norm, ?), 0),
					similarity(song_norm || ' ' || artist_norm, ?)
				)::DOUBLE PRECISION AS match_score,
				2 AS tier
			FROM lyrics
			WHERE deleted_at IS NULL
				AND NOT ${AUTO_HIDE_PREDICATE}
				AND (similarity(song_norm, ?) > ?
					OR similarity(artist_norm, ?) > ?
					OR (album_norm IS NOT NULL AND similarity(album_norm, ?) > ?)
					OR similarity(song_norm || ' ' || artist_norm, ?) > ?)

			UNION ALL

			SELECT ${SEARCH_COLUMNS},
				ts_rank(lyrics_text_search, plainto_tsquery('simple', ?))::DOUBLE PRECISION AS match_score,
				3 AS tier
			FROM lyrics
			WHERE lyrics_text_search @@ plainto_tsquery('simple', ?) AND deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE}
		) AS combined
		ORDER BY id, tier ASC, match_score DESC
	`

	const ranked = `
		SELECT * FROM (${sql}) AS deduped
		ORDER BY tier ASC, (match_score * ${RANKING_EXPR}) DESC
		LIMIT ?
	`

	const result = await env.DB.prepare(ranked)
		.bind(
			query.trim(),
			query.trim(),
			normalized,
			normalized,
			normalized,
			normalized,
			normalized,
			threshold,
			normalized,
			threshold,
			normalized,
			threshold,
			normalized,
			threshold,
			query.trim(),
			query.trim(),
			limit
		)
		.all<LyricsSearchResult>()

	return result.results
}
