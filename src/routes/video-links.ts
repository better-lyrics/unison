import { linkVideoForOwner, listVideoLinks, unlinkVideoForOwner } from "@/db/video-links"
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

export const videoLinkRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get("/:id/videos", async ({ params, env, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			return { success: true, videos: await listVideoLinks(env, id) }
		})
		.use(eitherAuth)
		.post("/:id/videos", async ({ params, env, userId, body, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const videoId = (body as { videoId?: unknown }).videoId
			if (typeof videoId !== "string") return status(400, buildError(ErrorCode.INVALID_ID))
			const res = await linkVideoForOwner(env, id, userId, videoId)
			if (!res.ok) {
				const mapped = LINK_ERROR[res.reason]
				return status(mapped.status, buildError(mapped.code))
			}
			return { success: true, videos: res.videos }
		})
		.delete("/:id/videos/:videoId", async ({ params, env, userId, status }) => {
			const id = Number(params.id)
			if (Number.isNaN(id)) return status(400, buildError(ErrorCode.INVALID_ID))
			const res = await unlinkVideoForOwner(env, id, userId, params.videoId)
			if (!res.ok) {
				const mapped = UNLINK_ERROR[res.reason]
				return status(mapped.status, buildError(mapped.code))
			}
			return { success: true, videos: res.videos }
		})
