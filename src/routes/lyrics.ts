import { findBySongArtist, findByVideoId, getLyricsById, submitLyrics } from "@/db/lyrics"
import { getOrCreateUser } from "@/db/users"
import {
	IdParamSchema,
	LyricsSubmissionSchema,
	SongArtistQuerySchema,
	VideoIdQuerySchema,
} from "@/schemas"
import type { ApiResponse, Confidence, Env, LyricsResponse, LyricsSubmission } from "@/types"
import { hashDeviceId } from "@/utils/hash"
import { type } from "arktype"
import { Hono } from "hono"

type Variables = { deviceHash: string; userId: number }

const lyrics = new Hono<{ Bindings: Env; Variables: Variables }>()

lyrics.use("*", async (c, next) => {
	const deviceId = c.req.header("x-device-id")
	if (!deviceId) {
		return c.json<ApiResponse>({ success: false, error: "Missing X-Device-ID header" }, 401)
	}
	const deviceHash = hashDeviceId(deviceId)
	const user = await getOrCreateUser(c.env, deviceHash)
	c.set("deviceHash", deviceHash)
	c.set("userId", user.id)
	await next()
})

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
	// Try videoId first
	const videoQuery = VideoIdQuerySchema({ v: c.req.query("v") })
	if (!(videoQuery instanceof type.errors)) {
		const result = await findByVideoId(c.env, videoQuery.v)
		if (!result) {
			return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
		}
		return c.json<ApiResponse<LyricsResponse>>({ success: true, data: toResponse(result) })
	}

	// Try song/artist
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
			songQuery.duration
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

lyrics.post("/submit", async (c) => {
	const deviceHash = c.get("deviceHash")
	const userId = c.get("userId")

	const { success } = await c.env.RATE_LIMITER.limit({ key: deviceHash })
	if (!success) {
		return c.json<ApiResponse>({ success: false, error: "Rate limited. Try again later." }, 429)
	}

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json<ApiResponse>({ success: false, error: "Invalid JSON" }, 400)
	}

	const parsed = LyricsSubmissionSchema(body)
	if (parsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: parsed.summary }, 400)
	}

	const durationMs = parsed.duration < 1000 ? parsed.duration * 1000 : parsed.duration

	const submission: LyricsSubmission = {
		videoId: parsed.videoId,
		song: parsed.song,
		artist: parsed.artist,
		album: parsed.album,
		duration: durationMs,
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

export default lyrics
