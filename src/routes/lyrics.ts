import { Elysia, t } from "elysia"
import {
	findBySongArtist,
	findByVideoId,
	getLyricsById,
	searchByQuery,
	searchBySongArtist,
	submitLyrics,
} from "@/db/lyrics"
import type { Confidence, Env, LyricsResponse, LyricsSearchResult, LyricsSubmission } from "@/types"
import { signedRequest } from "@/utils/auth"
import { config } from "@/config"
import { Logger } from "@/infra/logger"

const log = new Logger("app")

function toResponse(row: {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
	isrc: string | null
	lyrics: string
	format: "ttml" | "lrc" | "plain"
	language: string | null
	sync_type: string
	score: number
	effective_score: number
	vote_count: number
	confidence: Confidence
}): LyricsResponse {
	return {
		id: row.id,
		videoId: row.video_id,
		song: row.song,
		artist: row.artist,
		album: row.album || undefined,
		isrc: row.isrc || undefined,
		lyrics: row.lyrics,
		format: row.format,
		language: row.language || undefined,
		syncType: row.sync_type,
		score: row.score,
		effectiveScore: row.effective_score,
		voteCount: row.vote_count,
		confidence: row.confidence,
	}
}

function toSearchResponse(row: LyricsSearchResult) {
	return {
		id: row.id,
		videoId: row.video_id,
		song: row.song,
		artist: row.artist,
		album: row.album || undefined,
		isrc: row.isrc || undefined,
		duration: row.duration,
		format: row.format,
		language: row.language || undefined,
		syncType: row.sync_type,
		score: row.score,
		effectiveScore: row.effective_score,
		voteCount: row.vote_count,
		confidence: row.confidence,
		matchScore: row.match_score,
	}
}

export const lyricsRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get(
			"/",
			async ({ query, env, status }) => {
				if (query.v) {
					const result = await findByVideoId(env, query.v)
					if (!result) {
						return status(404, { success: false, error: "Lyrics not found" })
					}
					return { success: true, data: toResponse(result) }
				}

				if (query.song && query.artist) {
					const duration = query.duration ? Number(query.duration) : undefined
					const result = await findBySongArtist(
						env,
						query.song,
						query.artist,
						duration,
						query.album
					)
					if (!result) {
						return status(404, { success: false, error: "Lyrics not found" })
					}
					return { success: true, data: toResponse(result) }
				}

				return status(400, {
					success: false,
					error: "Provide either 'v' (videoId) or 'song' + 'artist'",
				})
			},
			{
				query: t.Object({
					v: t.Optional(t.String()),
					song: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					duration: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/search",
			async ({ query, env, status }) => {
				const limit = Math.min(
					Math.max(1, query.limit ? Number(query.limit) : config.search.defaultLimit),
					config.search.maxLimit
				)

				if (query.q) {
					const results = await searchByQuery(env, query.q, limit)
					log.info("query search", {
						query_length: query.q.length,
						result_count: results.length,
						top_tier: results[0]?.tier,
						top_match_score: results[0]?.match_score,
					})
					return { success: true, data: results.map(toSearchResponse) }
				}

				if (query.song && query.artist) {
					const duration = query.duration ? Number(query.duration) : undefined
					const results = await searchBySongArtist(
						env,
						query.song,
						query.artist,
						duration,
						query.album,
						limit
					)
					return { success: true, data: results.map(toResponse) }
				}

				return status(400, {
					success: false,
					error: "Provide 'q' for fuzzy search, or 'song' + 'artist' for exact match",
				})
			},
			{
				query: t.Object({
					q: t.Optional(t.String()),
					song: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					duration: t.Optional(t.String()),
					limit: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/:id",
			async ({ params, env, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, { success: false, error: "Invalid ID" })
				}

				const result = await getLyricsById(env, id)
				if (!result) {
					return status(404, { success: false, error: "Lyrics not found" })
				}

				return { success: true, data: toResponse(result) }
			},
			{
				params: t.Object({ id: t.String() }),
			}
		)
		.use(signedRequest)
		.post("/submit", async ({ env, keyId, userId, signedPayload, status }) => {
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) {
				return status(429, { success: false, error: "Rate limited. Try again later." })
			}

			const p = signedPayload
			if (
				typeof p.videoId !== "string" ||
				!p.videoId ||
				typeof p.song !== "string" ||
				!p.song ||
				typeof p.artist !== "string" ||
				!p.artist ||
				typeof p.duration !== "number" ||
				typeof p.lyrics !== "string" ||
				!p.lyrics ||
				typeof p.format !== "string" ||
				!["ttml", "lrc", "plain"].includes(p.format)
			) {
				return status(400, { success: false, error: "Invalid submission payload" })
			}

			if ((p.song as string).length > config.validation.song.maxLength) {
				return status(400, { success: false, error: "Song name too long" })
			}
			if ((p.artist as string).length > config.validation.artist.maxLength) {
				return status(400, { success: false, error: "Artist name too long" })
			}
			if ((p.lyrics as string).length > config.validation.ttml.maxSizeBytes) {
				return status(400, { success: false, error: "Lyrics content too large" })
			}
			if (
				(p.duration as number) < config.validation.duration.min ||
				(p.duration as number) > config.validation.duration.max
			) {
				return status(400, { success: false, error: "Invalid duration" })
			}

			const submission: LyricsSubmission = {
				videoId: p.videoId as string,
				song: p.song as string,
				artist: p.artist as string,
				album: typeof p.album === "string" ? p.album : undefined,
				isrc: typeof p.isrc === "string" ? p.isrc : undefined,
				duration: p.duration as number,
				lyrics: p.lyrics as string,
				format: p.format as "ttml" | "lrc" | "plain",
				language: typeof p.language === "string" ? p.language : undefined,
				syncType:
					typeof p.syncType === "string" && ["richsync", "linesync", "plain"].includes(p.syncType)
						? (p.syncType as "richsync" | "linesync" | "plain")
						: undefined,
			}

			const result = await submitLyrics(env, submission, userId)

			return status(result.created ? 201 : 409, {
				success: true,
				data: result,
			})
		})
