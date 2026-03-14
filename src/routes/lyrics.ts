import { Elysia, t } from "elysia"
import {
	findBySongArtist,
	findByVideoId,
	getLyricsById,
	searchBySongArtist,
	submitLyrics,
} from "@/db/lyrics"
import type { Confidence, Env, LyricsResponse, LyricsSubmission } from "@/types"
import { signedRequest } from "@/utils/auth"
import { config } from "@/config"

function toResponse(row: {
	id: number
	video_id: string
	song: string
	artist: string
	album: string | null
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
				if (!query.song || !query.artist) {
					return status(400, { success: false, error: "Provide 'song' and 'artist'" })
				}

				const duration = query.duration ? Number(query.duration) : undefined
				const results = await searchBySongArtist(
					env,
					query.song,
					query.artist,
					duration,
					query.album
				)

				return { success: true, data: results.map(toResponse) }
			},
			{
				query: t.Object({
					song: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					duration: t.Optional(t.String()),
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
				duration: p.duration as number,
				lyrics: p.lyrics as string,
				format: p.format as "ttml" | "lrc" | "plain",
				language: typeof p.language === "string" ? p.language : undefined,
				syncType:
					typeof p.syncType === "string" &&
					["richsync", "linesync", "plain"].includes(p.syncType)
						? (p.syncType as "richsync" | "linesync" | "plain")
						: undefined,
			}

			const result = await submitLyrics(env, submission, userId)

			return status(result.updated ? 200 : 201, {
				success: true,
				data: result,
			})
		})
