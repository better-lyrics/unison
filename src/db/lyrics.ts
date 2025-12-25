import { config } from "@/config"
import type { Env, LyricsRow, LyricsSubmission } from "@/types"
import { compress, decompress, isCompressed } from "@/utils/compression"
import { normalizeArtist, normalizeSong } from "@/utils/normalize"

export async function findByVideoId(env: Env, videoId: string): Promise<LyricsRow | null> {
	const cached = await env.CACHE.get(`v:${videoId}`)
	if (cached) {
		try {
			const row = JSON.parse(cached) as LyricsRow
			if (isCompressed(row.lyrics)) {
				row.lyrics = await decompress(row.lyrics)
			}
			return row
		} catch {
			await env.CACHE.delete(`v:${videoId}`)
		}
	}

	const result = await env.DB.prepare("SELECT * FROM lyrics WHERE video_id = ?")
		.bind(videoId)
		.first<LyricsRow>()

	if (result) {
		if (isCompressed(result.lyrics)) {
			result.lyrics = await decompress(result.lyrics)
		}
		await cacheResult(env, result)
	}

	return result
}

export async function findBySongArtist(
	env: Env,
	song: string,
	artist: string,
	durationMs?: number
): Promise<LyricsRow | null> {
	const songNorm = normalizeSong(song)
	const artistNorm = normalizeArtist(artist)

	let query: string
	let params: (string | number)[]

	if (durationMs !== undefined) {
		query = `
			SELECT * FROM lyrics
			WHERE song_norm = ? AND artist_norm = ?
			AND ABS(duration_ms - ?) <= ?
			ORDER BY score DESC
			LIMIT 1
		`
		params = [songNorm, artistNorm, durationMs, config.matching.durationToleranceMs]
	} else {
		query = `
			SELECT * FROM lyrics
			WHERE song_norm = ? AND artist_norm = ?
			ORDER BY score DESC
			LIMIT 1
		`
		params = [songNorm, artistNorm]
	}

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
	const songNorm = normalizeSong(submission.song)
	const artistNorm = normalizeArtist(submission.artist)

	const existing = await env.DB.prepare("SELECT id, score FROM lyrics WHERE video_id = ?")
		.bind(submission.videoId)
		.first<{ id: number; score: number }>()

	if (existing) {
		if (existing.score >= config.protection.minScoreToProtect) {
			return { id: existing.id, updated: false }
		}

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
				duration_ms = ?,
				song_norm = ?,
				artist_norm = ?,
				submitter_id = ?,
				updated_at = unixepoch()
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
				submission.duration,
				songNorm,
				artistNorm,
				submitterId,
				existing.id
			)
			.run()

		await invalidateCache(env, submission.videoId)

		return { id: existing.id, updated: true }
	}

	const result = await env.DB.prepare(
		`
		INSERT INTO lyrics (
			video_id, song, artist, album,
			duration_ms, song_norm, artist_norm,
			lyrics, format, language, sync_type, submitter_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		RETURNING id
		`
	)
		.bind(
			submission.videoId,
			submission.song.trim(),
			submission.artist.trim(),
			submission.album?.trim() || null,
			submission.duration,
			songNorm,
			artistNorm,
			compressedLyrics,
			submission.format,
			submission.language || null,
			submission.syncType || "linesync",
			submitterId
		)
		.first<{ id: number }>()

	return { id: result!.id, updated: false }
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

async function invalidateCache(env: Env, videoId: string): Promise<void> {
	await env.CACHE.delete(`v:${videoId}`)
}
