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
const SYNC_TYPE_BOOST = `CASE sync_type
	WHEN 'richsync' THEN ${syncTypeBoost.richsync}
	WHEN 'linesync' THEN ${syncTypeBoost.linesync}
	ELSE ${syncTypeBoost.plain}
END`

export const RANKING_EXPR = `(
	(effective_score * LN(vote_count + ${config.ranking.confidenceBase})
	+ ${config.ranking.recencyWeight} / (1.0 + (EXTRACT(EPOCH FROM NOW())::INTEGER - created_at) / 86400.0))
	* ${SYNC_TYPE_BOOST}
)`

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
	const result = await env.DB.prepare("SELECT * FROM lyrics WHERE video_id = ?")
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

export async function findBySongArtist(
	env: Env,
	song: string,
	artist: string,
	duration?: number,
	album?: string
): Promise<LyricsRow | null> {
	const songNorm = normalizeSong(song)
	const artistNorm = normalizeArtist(artist)

	const conditions = ["song_norm = ?", "artist_norm = ?"]
	const params: (string | number)[] = [songNorm, artistNorm]

	if (duration !== undefined) {
		conditions.push("ABS(duration - ?) <= ?")
		params.push(duration, config.matching.durationTolerance)
	}

	if (album) {
		conditions.push("album = ?")
		params.push(album.trim())
	}

	const query = `
		SELECT * FROM lyrics
		WHERE ${conditions.join(" AND ")}
		ORDER BY ${RANKING_EXPR} DESC
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
): Promise<{ id: number; updated: boolean }> {
	const compressedLyrics = await compress(submission.lyrics)
	const plainText = extractPlainText(submission.lyrics, submission.format)
	const songNorm = normalizeSong(submission.song)
	const artistNorm = normalizeArtist(submission.artist)
	const albumNorm = submission.album ? normalize(submission.album) : null

	const existing = await env.DB.prepare(
		"SELECT id, effective_score, vote_count FROM lyrics WHERE video_id = ?"
	)
		.bind(submission.videoId)
		.first<{ id: number; effective_score: number; vote_count: number }>()

	if (existing) {
		if (
			existing.effective_score >= config.protection.minEffectiveScoreToProtect &&
			existing.vote_count >= config.protection.minVotesToProtect
		) {
			log.info("submission blocked by score protection", {
				videoId: submission.videoId,
				id: existing.id,
				effective_score: existing.effective_score,
				vote_count: existing.vote_count,
			})
			return { id: existing.id, updated: false }
		}

		log.info("updating existing lyrics", { videoId: submission.videoId, id: existing.id })
		await env.DB.prepare(
			`
			UPDATE lyrics SET
				lyrics = ?,
				format = ?,
				sync_type = ?,
				language = ?,
				song = ?,
				artist = ?,
				album = ?,
				isrc = ?,
				duration = ?,
				song_norm = ?,
				artist_norm = ?,
				album_norm = ?,
				submitter_id = ?,
				lyrics_text_search = to_tsvector('simple', ?),
				updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
			WHERE id = ?
			`
		)
			.bind(
				compressedLyrics,
				submission.format,
				submission.syncType || "linesync",
				submission.language || null,
				submission.song.trim(),
				submission.artist.trim(),
				submission.album?.trim() || null,
				submission.isrc || null,
				submission.duration,
				songNorm,
				artistNorm,
				albumNorm,
				submitterId,
				plainText,
				existing.id
			)
			.run()

		await invalidateCache(env, submission.videoId)

		return { id: existing.id, updated: true }
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
			submission.syncType || "linesync",
			submitterId,
			plainText
		)
		.first<{ id: number }>()

	log.info("new lyrics submitted", {
		videoId: submission.videoId,
		id: result!.id,
		format: submission.format,
	})
	return { id: result!.id, updated: false }
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

	const conditions = ["song_norm = ?", "artist_norm = ?"]
	const params: (string | number)[] = [songNorm, artistNorm]

	if (duration !== undefined) {
		conditions.push("ABS(duration - ?) <= ?")
		params.push(duration, config.matching.durationTolerance)
	}

	if (album) {
		conditions.push("album = ?")
		params.push(album.trim())
	}

	params.push(limit)

	const results = await env.DB.prepare(
		`
		SELECT * FROM lyrics
		WHERE ${conditions.join(" AND ")}
		ORDER BY ${RANKING_EXPR} DESC
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
	const result = await env.DB.prepare("SELECT * FROM lyrics WHERE id = ?")
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
			WHERE video_id = ? OR isrc = ?

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
			WHERE similarity(song_norm, ?) > ?
				OR similarity(artist_norm, ?) > ?
				OR (album_norm IS NOT NULL AND similarity(album_norm, ?) > ?)
				OR similarity(song_norm || ' ' || artist_norm, ?) > ?

			UNION ALL

			SELECT ${SEARCH_COLUMNS},
				ts_rank(lyrics_text_search, plainto_tsquery('simple', ?))::DOUBLE PRECISION AS match_score,
				3 AS tier
			FROM lyrics
			WHERE lyrics_text_search @@ plainto_tsquery('simple', ?)
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
