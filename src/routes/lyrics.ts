import {
	findBySongArtist,
	findByVideoId,
	getLyricsById,
	searchBySongArtist,
	submitLyrics,
} from "@/db/lyrics"
import {
	IdParamSchema,
	LyricsSubmissionSchema,
	SongArtistQuerySchema,
	VideoIdQuerySchema,
} from "@/schemas"
import type { ApiResponse, Confidence, Env, LyricsResponse, LyricsSubmission } from "@/types"
import { createSignedRequestMiddleware } from "@/utils/auth"
import { type } from "arktype"
import { Hono } from "hono"

type Variables = { keyId: string; userId: number; signedPayload: Record<string, unknown> }

const lyrics = new Hono<{ Bindings: Env; Variables: Variables }>()

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

lyrics.get("/", async (c) => {
	const videoQuery = VideoIdQuerySchema({ v: c.req.query("v") })
	if (!(videoQuery instanceof type.errors)) {
		const result = await findByVideoId(c.env, videoQuery.v)
		if (!result) {
			return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
		}
		return c.json<ApiResponse<LyricsResponse>>({ success: true, data: toResponse(result) })
	}

	const songQuery = SongArtistQuerySchema({
		song: c.req.query("song"),
		artist: c.req.query("artist"),
		album: c.req.query("album"),
		duration: c.req.query("duration"),
	})
	if (!(songQuery instanceof type.errors)) {
		const result = await findBySongArtist(
			c.env,
			songQuery.song,
			songQuery.artist,
			songQuery.duration,
			songQuery.album
		)
		if (!result) {
			return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
		}
		return c.json<ApiResponse<LyricsResponse>>({ success: true, data: toResponse(result) })
	}

	return c.json<ApiResponse>(
		{ success: false, error: "Provide either 'v' (videoId) or 'song' + 'artist'" },
		400
	)
})

lyrics.get("/search", async (c) => {
	const query = SongArtistQuerySchema({
		song: c.req.query("song"),
		artist: c.req.query("artist"),
		album: c.req.query("album"),
		duration: c.req.query("duration"),
	})
	if (query instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Provide 'song' and 'artist'" }, 400)
	}

	const results = await searchBySongArtist(
		c.env,
		query.song,
		query.artist,
		query.duration,
		query.album
	)

	return c.json<ApiResponse<LyricsResponse[]>>({
		success: true,
		data: results.map(toResponse),
	})
})

lyrics.get("/:id", async (c) => {
	const parsed = IdParamSchema({ id: c.req.param("id") })
	if (parsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const result = await getLyricsById(c.env, parsed.id)
	if (!result) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	return c.json<ApiResponse<LyricsResponse>>({ success: true, data: toResponse(result) })
})

lyrics.post("/submit", createSignedRequestMiddleware(), async (c) => {
	const keyId = c.get("keyId")
	const userId = c.get("userId")
	const payload = c.get("signedPayload")

	const { success } = await c.env.RATE_LIMITER.limit({ key: keyId })
	if (!success) {
		return c.json<ApiResponse>({ success: false, error: "Rate limited. Try again later." }, 429)
	}

	const parsed = LyricsSubmissionSchema(payload)
	if (parsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: parsed.summary }, 400)
	}

	const submission: LyricsSubmission = {
		videoId: parsed.videoId,
		song: parsed.song,
		artist: parsed.artist,
		album: parsed.album,
		duration: parsed.duration,
		lyrics: parsed.lyrics,
		format: parsed.format,
		language: parsed.language,
		syncType: parsed.syncType,
	}

	const result = await submitLyrics(c.env, submission, userId)

	return c.json<ApiResponse<{ id: number; updated: boolean }>>(
		{ success: true, data: result },
		result.updated ? 200 : 201
	)
})

export default lyrics
