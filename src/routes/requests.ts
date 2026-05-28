import { Elysia } from "elysia"
import { config } from "@/config"
import { createRequest } from "@/db/requests"
import { getUserById } from "@/db/users"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
import { ErrorCode, buildError } from "@/utils/errors"

export const requestRoutes = (env: Env) =>
	new Elysia({ prefix: "/requests" })
		.decorate("env", env)
		.use(signedRequest)
		.post("/", async ({ env, keyId, userId, signedPayload, status }) => {
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) {
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			}

			const p = signedPayload
			if (
				typeof p.videoId !== "string" ||
				!p.videoId ||
				typeof p.song !== "string" ||
				!p.song ||
				typeof p.artist !== "string" ||
				!p.artist
			) {
				return status(
					400,
					buildError(ErrorCode.INVALID_PAYLOAD, { error: "Invalid request payload" })
				)
			}

			if (p.song.length > config.validation.song.maxLength) {
				return status(400, buildError(ErrorCode.SONG_TOO_LONG))
			}
			if (p.artist.length > config.validation.artist.maxLength) {
				return status(400, buildError(ErrorCode.ARTIST_TOO_LONG))
			}

			const thumbnailUrl =
				typeof p.thumbnailUrl === "string" && p.thumbnailUrl ? p.thumbnailUrl : null

			const user = await getUserById(env, userId)
			const weight = user?.reputation ?? 1.0

			const result = await createRequest(env, {
				videoId: p.videoId,
				song: p.song,
				artist: p.artist,
				thumbnailUrl,
				requesterId: keyId,
				requesterType: "extension",
				weight,
			})

			if (result.status === "already_available") {
				return status(200, { success: true, data: { status: result.status } })
			}

			const code = result.status === "created" ? 201 : 200
			return status(code, { success: true, data: result })
		})
