import { config } from "@/config"
import { linkVideoForOwner, listVideoLinks, unlinkVideoForOwner } from "@/db/video-links"
import {
	type SongForSuggestions,
	suggestVideosForSong,
	suggestVideosForVariant,
} from "@/services/video-suggestions"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia } from "elysia"

const LINK_ERROR = {
	invalid_id: { status: 400, code: ErrorCode.INVALID_ID },
	not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	not_owner: { status: 403, code: ErrorCode.NOT_OWNER },
	unverifiable: { status: 422, code: ErrorCode.VIDEO_UNVERIFIABLE },
	duration_mismatch: { status: 422, code: ErrorCode.DURATION_MISMATCH },
	cap_reached: { status: 409, code: ErrorCode.LINK_CAP_REACHED },
} as const

const UNLINK_ERROR = {
	not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	not_owner: { status: 403, code: ErrorCode.NOT_OWNER },
	cannot_unlink_primary: { status: 409, code: ErrorCode.CANNOT_UNLINK_PRIMARY },
} as const

const VIDEO_ID_LENGTH = 11

function isNamed(value: unknown, maxLength: number): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
}

function parseSongForSuggestions(body: Record<string, unknown>): SongForSuggestions | null {
	const { song, artist, album, duration, videoId } = body
	if (!isNamed(song, config.validation.song.maxLength)) return null
	if (!isNamed(artist, config.validation.artist.maxLength)) return null
	if (album !== undefined && album !== null && typeof album !== "string") return null
	if (
		typeof duration !== "number" ||
		!Number.isFinite(duration) ||
		duration < config.validation.duration.min ||
		duration > config.validation.duration.max
	) {
		return null
	}
	if (
		videoId !== undefined &&
		(typeof videoId !== "string" || videoId.length !== VIDEO_ID_LENGTH)
	) {
		return null
	}
	return { song, artist, album: album ?? null, duration, videoId }
}

function limitSuggestions(env: Env, keyId: string) {
	return env.RATE_LIMITER.limit({
		key: `suggest:${keyId}`,
		maxRequests: config.rateLimit.suggest.maxRequests,
		windowSeconds: config.rateLimit.suggest.windowSeconds,
	})
}

export const videoLinkRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get("/:id/videos", async ({ params, env, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			return { success: true, data: { videos: await listVideoLinks(env, id) } }
		})
		.use(eitherAuth)
		.post("/:id/videos", async ({ params, env, userId, keyId, body, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const videoId = (body as { videoId?: unknown }).videoId
			if (typeof videoId !== "string") return status(400, buildError(ErrorCode.INVALID_ID))
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))
			const res = await linkVideoForOwner(env, id, userId, videoId)
			if (!res.ok) {
				const mapped = LINK_ERROR[res.reason]
				return status(mapped.status, buildError(mapped.code))
			}
			return { success: true, data: { videos: res.videos } }
		})
		.post("/:id/suggested-videos", async ({ params, env, userId, keyId, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const { success } = await limitSuggestions(env, keyId)
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))
			const res = await suggestVideosForVariant(env, id, userId)
			if (!res.ok) {
				if (res.reason === "not_owner") return status(403, buildError(ErrorCode.NOT_OWNER))
				return status(404, buildError(ErrorCode.NOT_FOUND))
			}
			return { success: true, data: { suggestions: res.suggestions } }
		})
		.post("/suggested-videos", async ({ env, keyId, body, status }) => {
			const song = parseSongForSuggestions(body)
			if (!song) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			const { success } = await limitSuggestions(env, keyId)
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))
			return { success: true, data: { suggestions: await suggestVideosForSong(env, song) } }
		})
		.delete("/:id/videos/:videoId", async ({ params, env, userId, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const res = await unlinkVideoForOwner(env, id, userId, params.videoId)
			if (!res.ok) {
				const mapped = UNLINK_ERROR[res.reason]
				return status(mapped.status, buildError(mapped.code))
			}
			return { success: true, data: { videos: res.videos } }
		})
