import { config } from "@/config"
import { awardFirstForSongXp } from "@/db/contribution-events"
import { recordFulfillment } from "@/db/fulfillments"
import {
	AUTO_HIDE_PREDICATE,
	AUTO_HIDE_PREDICATE_JOINED,
	PROVEN_EXPR_JOINED,
	RANKING_EXPR,
	RANKING_EXPR_JOINED,
} from "@/db/predicates"
import { Logger } from "@/infra/logger"
import type { Env, LyricsRow, LyricsSearchResult, LyricsSubmission } from "@/types"
import { compress, decompress, isCompressed } from "@/utils/compression"
import { DETECTOR_VERSION, detectLanguage } from "@/utils/detect-language"
import {
	allowedSyncTiers,
	epsilonForTier,
	hashBucket,
	hashSeed,
	selectArm,
} from "@/utils/exploration"
import { extractPlainText } from "@/utils/extract-text"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"

const log = new Logger("db")
const cacheLog = new Logger("cache")
const exploreLog = new Logger("explore")

const LYRICS_WITH_SUBMITTER = `
	SELECT l.*, u.key_id AS submitter_key_id, u.reputation AS submitter_reputation,
		u.nickname AS submitter_nickname,
		${AUTO_HIDE_PREDICATE_JOINED} AS hidden
	FROM lyrics l
	LEFT JOIN users u ON l.submitter_id = u.id
`

async function hydrateSubmitter(env: Env, row: LyricsRow): Promise<void> {
	if (row.submitter_id == null) return
	const user = await env.DB.prepare("SELECT reputation, nickname FROM users WHERE id = ?")
		.bind(row.submitter_id)
		.first<{ reputation: number; nickname: string | null }>()
	if (user) {
		row.submitter_reputation = user.reputation
		row.submitter_nickname = user.nickname
	}
}

async function getPrimary(env: Env, videoId: string): Promise<LyricsRow | null> {
	const cached = await env.CACHE.get(`v:${videoId}`)
	if (cached) {
		try {
			const row = JSON.parse(cached) as LyricsRow
			if (isCompressed(row.lyrics)) {
				row.lyrics = await decompress(row.lyrics)
			}
			await hydrateSubmitter(env, row)
			cacheLog.debug("hit", { key: `v:${videoId}` })
			return row
		} catch {
			cacheLog.warn("corrupt entry, evicting", { key: `v:${videoId}` })
			await env.CACHE.delete(`v:${videoId}`)
		}
	}

	cacheLog.debug("miss", { key: `v:${videoId}` })
	const result = await env.DB.prepare(
		`${LYRICS_WITH_SUBMITTER} WHERE l.video_id = ? AND l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED} ORDER BY (CASE WHEN ${PROVEN_EXPR_JOINED} THEN 1 ELSE 0 END) DESC, ${RANKING_EXPR_JOINED} DESC LIMIT 1`
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

export async function findEligibleChallengers(
	env: Env,
	videoId: string,
	primary: LyricsRow
): Promise<LyricsRow[]> {
	const tiers = [...allowedSyncTiers(primary.sync_type)]
	const tierPlaceholders = tiers.map(() => "?").join(", ")

	const results = await env.DB.prepare(
		`
		${LYRICS_WITH_SUBMITTER}
		WHERE l.video_id = ?
			AND l.deleted_at IS NULL
			AND l.id <> ?
			AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
			AND l.reputation_penalized = FALSE
			AND COALESCE(u.reputation, 0) >= ?
			AND l.sync_type IN (${tierPlaceholders})
			AND l.vote_count < ?
			AND (SELECT COUNT(*) FROM reports r WHERE r.lyrics_id = l.id) < ?
		ORDER BY l.vote_count ASC, l.created_at ASC, l.id ASC
		LIMIT ?
		`
	)
		.bind(
			videoId,
			primary.id,
			config.exploration.minSubmitterReputation,
			...tiers,
			config.exploration.coldMaxVotes,
			config.moderation.reportsThreshold,
			config.exploration.maxChallengers + 1
		)
		.all<LyricsRow>()

	let rows = results.results
	if (rows.length > config.exploration.maxChallengers) {
		exploreLog.info("explore.pool_capped", {
			videoId,
			cap: config.exploration.maxChallengers,
		})
		rows = rows.slice(0, config.exploration.maxChallengers)
	}

	for (const row of rows) {
		if (isCompressed(row.lyrics)) {
			row.lyrics = await decompress(row.lyrics)
		}
	}

	return rows
}

export async function findByVideoId(
	env: Env,
	videoId: string,
	keyId: string | null = null
): Promise<LyricsRow | null> {
	const primary = await getPrimary(env, videoId)
	if (!primary) return null
	if (!keyId || !config.exploration.enabled) return primary

	const bucket = hashBucket(keyId, videoId)
	const eps = epsilonForTier(primary.confidence)
	if (bucket >= eps) return primary

	const challengers = await findEligibleChallengers(env, videoId, primary)
	if (challengers.length === 0) return primary

	const arm = selectArm(challengers, hashSeed(keyId, videoId))
	exploreLog.info("explore.serve", {
		videoId,
		incumbentId: primary.id,
		incumbentConfidence: primary.confidence,
		eps,
		bucket,
		armId: arm.id,
		armVoteCount: arm.vote_count,
		poolSize: challengers.length,
	})
	return arm
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
		ORDER BY (CASE WHEN ${PROVEN_EXPR_JOINED} THEN 1 ELSE 0 END) DESC, ${RANKING_EXPR_JOINED} DESC
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
		`SELECT COUNT(*)::INTEGER AS count FROM lyrics
			WHERE video_id = ? AND submitter_id = ?
				AND (deleted_at IS NULL OR reputation_penalized = TRUE)`
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

	let language: string | null
	let languageSource: "submitter" | "detector"
	let languageDetectorVersion: number | null
	let languageDetectionAttemptedAt: "NOW" | null

	if (submission.language) {
		language = submission.language
		languageSource = "submitter"
		languageDetectorVersion = null
		languageDetectionAttemptedAt = null
	} else {
		const detected = await detectLanguage(plainText)
		language = detected.language
		languageSource = "detector"
		languageDetectorVersion = detected.ready ? DETECTOR_VERSION : null
		languageDetectionAttemptedAt = "NOW"
	}

	const result = await env.DB.prepare(
		`
		INSERT INTO lyrics (
			video_id, song, artist, album, isrc,
			duration, song_norm, artist_norm, album_norm,
			lyrics, format, language, sync_type, submitter_id,
			lyrics_text_search,
			language_source, language_detector_version, language_detection_attempted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_tsvector('simple', ?), ?, ?, ${
			languageDetectionAttemptedAt === "NOW" ? "NOW()" : "NULL"
		})
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
			language,
			submission.syncType,
			submitterId,
			plainText,
			languageSource,
			languageDetectorVersion
		)
		.first<{ id: number }>()

	log.info("new lyrics submitted", {
		videoId: submission.videoId,
		id: result!.id,
		format: submission.format,
		sync_type: submission.syncType,
	})

	if (submission.syncType === "linesync" || submission.syncType === "richsync") {
		const submitter = await env.DB.prepare("SELECT key_id FROM users WHERE id = ?")
			.bind(submitterId)
			.first<{ key_id: string }>()

		if (submitter) {
			await recordFulfillment(env, {
				videoId: submission.videoId,
				lyricsId: result!.id,
				submitterId,
				submitterKeyId: submitter.key_id,
			})
		}
	}

	const earliest = await env.DB.prepare(
		"SELECT MIN(id) AS min_id FROM lyrics WHERE video_id = ? AND deleted_at IS NULL"
	)
		.bind(submission.videoId)
		.first<{ min_id: number | null }>()
	if (earliest && Number(earliest.min_id) === result!.id) {
		await awardFirstForSongXp(env, submitterId, result!.id).catch((err) =>
			log.warn("first-for-song xp failed", { error: (err as Error).message })
		)
	}

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

export async function invalidateCacheForSubmitter(env: Env, keyId: string): Promise<void> {
	const rows = await env.DB.prepare(
		`SELECT DISTINCT l.video_id
		FROM lyrics l
		JOIN users u ON l.submitter_id = u.id
		WHERE u.key_id = ? AND l.deleted_at IS NULL`
	)
		.bind(keyId)
		.all<{ video_id: string }>()
	await Promise.all(rows.results.map((r) => env.CACHE.delete(`v:${r.video_id}`)))
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
		`SELECT id, video_id, submitter_id, deleted_at,
			vote_count, effective_score, reputation_penalized
		FROM lyrics WHERE id = ?`
	)
		.bind(lyricsId)
		.first<{
			id: number
			video_id: string
			submitter_id: number
			deleted_at: number | null
			vote_count: number
			effective_score: number
			reputation_penalized: boolean
		}>()

	if (!row) return { deleted: false, reason: "not_found" }
	if (row.deleted_at !== null) return { deleted: false, reason: "already_deleted" }
	if (role === "submitter" && row.submitter_id !== actingUserId) {
		return { deleted: false, reason: "forbidden" }
	}

	const shouldPenalise =
		!row.reputation_penalized &&
		(role === "admin" || (role === "submitter" && row.vote_count >= 2 && row.effective_score < 0))

	await env.DB.transaction(async (tx) => {
		if (shouldPenalise && row.submitter_id) {
			const flipped = await tx
				.prepare(
					`UPDATE lyrics SET reputation_penalized = TRUE
					WHERE id = ? AND reputation_penalized = FALSE
					RETURNING id`
				)
				.bind(lyricsId)
				.first<{ id: number }>()

			if (flipped) {
				const penalty = config.moderation.autoHide.reputationPenalty
				await tx
					.prepare("UPDATE users SET reputation = GREATEST(?, reputation - ?) WHERE id = ?")
					.bind(config.reputation.min, penalty, row.submitter_id)
					.run()
			}
		}

		await tx
			.prepare(
				`UPDATE lyrics SET
					deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
					deleted_by_user_id = ?,
					deleted_by_role = ?,
					deletion_reason = ?
				WHERE id = ? AND deleted_at IS NULL`
			)
			.bind(actingUserId, role, reason, lyricsId)
			.run()
	})

	await invalidateCacheAfterDelete(env, row.video_id)
	log.info("lyrics deleted", { lyricsId, role, actingUserId, videoId: row.video_id })

	return { deleted: true }
}

const SEARCH_COLUMNS = `
	id, video_id, song, artist, album, isrc, duration,
	format, language, sync_type, score, effective_score,
	vote_count, confidence, created_at, submitter_id
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

	await attachSubmitters(env, result.results)
	return result.results
}

async function attachSubmitters(env: Env, rows: LyricsSearchResult[]): Promise<void> {
	const ids = [...new Set(rows.map((r) => r.submitter_id).filter((id): id is number => id != null))]
	if (ids.length === 0) return
	const placeholders = ids.map(() => "?").join(", ")
	const { results } = await env.DB.prepare(
		`SELECT id, key_id, reputation, nickname FROM users WHERE id IN (${placeholders})`
	)
		.bind(...ids)
		.all<{ id: number; key_id: string; reputation: number; nickname: string | null }>()
	const byId = new Map(results.map((u) => [u.id, u]))
	for (const row of rows) {
		const user = row.submitter_id != null ? byId.get(row.submitter_id) : undefined
		if (user) {
			row.submitter_key_id = user.key_id
			row.submitter_reputation = user.reputation
			row.submitter_nickname = user.nickname
		}
	}
}
