import { editLyrics } from "@/db/lyrics"
import { linkVideoForOwner, listVideoLinks, unlinkVideoForOwner } from "@/db/video-links"
import { suggestVideosForVariant } from "@/services/video-suggestions"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { validateLyricContent } from "@/utils/validate-lyrics"
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
		.post("/:id/suggested-videos", async ({ params, env, userId, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const res = await suggestVideosForVariant(env, id, userId)
			if (!res.ok) {
				if (res.reason === "not_owner") return status(403, buildError(ErrorCode.NOT_OWNER))
				return status(404, buildError(ErrorCode.NOT_FOUND))
			}
			return { success: true, data: { suggestions: res.suggestions } }
		})
		.post("/:id/edit", async ({ params, env, userId, keyId, body, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))

			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))

			const b = body as { lyrics?: unknown; format?: unknown; language?: unknown }
			if (typeof b.lyrics !== "string" || !b.lyrics) {
				return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			}
			const claimedFormat =
				typeof b.format === "string" && ["ttml", "lrc", "plain"].includes(b.format)
					? (b.format as "ttml" | "lrc" | "plain")
					: "plain"

			const validated = validateLyricContent(b.lyrics, claimedFormat)
			if (!validated.ok) {
				return status(
					400,
					buildError(validated.code, validated.hint ? { hint: validated.hint } : undefined)
				)
			}

			const res = await editLyrics(env, id, userId, {
				lyrics: b.lyrics,
				format: validated.format,
				syncType: validated.syncType,
				language: typeof b.language === "string" ? b.language : undefined,
			})
			if (!res.ok) {
				if (res.reason === "cap_reached") {
					return status(409, buildError(ErrorCode.VARIANT_CAP_REACHED))
				}
				return status(404, buildError(ErrorCode.NOT_FOUND))
			}
			return status(201, { success: true, data: { id: res.id, created: true } })
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
