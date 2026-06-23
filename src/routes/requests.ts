import { Elysia } from "elysia"
import { config } from "@/config"
import { getByDiscordId } from "@/db/discordLinks"
import { createRequest } from "@/db/requests"
import { getUserById, getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
import { isLinkBlacklisted } from "@/utils/blacklist"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { ErrorCode, buildError } from "@/utils/errors"

type FieldErrorCode =
	| typeof ErrorCode.INVALID_PAYLOAD
	| typeof ErrorCode.SONG_TOO_LONG
	| typeof ErrorCode.ARTIST_TOO_LONG

type RequestFields = { videoId: string; song: string; artist: string }

type FieldValidation = { ok: true; fields: RequestFields } | { ok: false; code: FieldErrorCode }

function validateRequestFields(p: Record<string, unknown>): FieldValidation {
	if (
		typeof p.videoId !== "string" ||
		!p.videoId ||
		typeof p.song !== "string" ||
		!p.song ||
		typeof p.artist !== "string" ||
		!p.artist
	) {
		return { ok: false, code: ErrorCode.INVALID_PAYLOAD }
	}
	if (p.song.length > config.validation.song.maxLength) {
		return { ok: false, code: ErrorCode.SONG_TOO_LONG }
	}
	if (p.artist.length > config.validation.artist.maxLength) {
		return { ok: false, code: ErrorCode.ARTIST_TOO_LONG }
	}
	return { ok: true, fields: { videoId: p.videoId, song: p.song, artist: p.artist } }
}

function fieldErrorBody(code: FieldErrorCode) {
	const overrides =
		code === ErrorCode.INVALID_PAYLOAD ? { error: "Invalid request payload" } : undefined
	return buildError(code, overrides)
}

function readThumbnailUrl(p: Record<string, unknown>): string | null {
	return typeof p.thumbnailUrl === "string" && p.thumbnailUrl ? p.thumbnailUrl : null
}

function readString(p: Record<string, unknown>, key: string): string | null {
	const value = p[key]
	return typeof value === "string" && value ? value : null
}

export const requestRoutes = (env: Env) =>
	new Elysia({ prefix: "/requests" })
		.decorate("env", env)
		.post("/bot", async ({ env, headers, body, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}

			const b = (body ?? {}) as Record<string, unknown>
			const validation = validateRequestFields(b)
			if (!validation.ok) {
				return status(400, fieldErrorBody(validation.code))
			}
			const { videoId, song, artist } = validation.fields

			const explicitKeyId = readString(b, "keyId")
			const discordId = readString(b, "discordId")
			const requesterIdInput = readString(b, "requesterId")

			let attributedKeyId = explicitKeyId
			if (!attributedKeyId && discordId) {
				const link = await getByDiscordId(env, discordId)
				attributedKeyId = link?.key_id ?? null
			}

			if (attributedKeyId && isLinkBlacklisted(attributedKeyId)) {
				return status(403, buildError(ErrorCode.LINK_BLACKLISTED))
			}

			const requesterId = attributedKeyId ?? discordId ?? requesterIdInput
			if (!requesterId) {
				return status(
					400,
					buildError(ErrorCode.INVALID_PAYLOAD, {
						error: "keyId, discordId, or requesterId required",
					})
				)
			}

			const { success } = await env.RATE_LIMITER.limit({ key: requesterId })
			if (!success) {
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			}

			let weight: number = config.requests.discordNeutralWeight
			if (attributedKeyId) {
				const user = await getUserByKeyId(env, attributedKeyId)
				weight = user?.reputation ?? config.requests.discordNeutralWeight
			}

			const result = await createRequest(env, {
				videoId,
				song,
				artist,
				thumbnailUrl: readThumbnailUrl(b),
				requesterId,
				requesterType: attributedKeyId ? "extension" : "discord",
				weight,
			})

			if (result.status === "already_available") {
				return status(200, { success: true, data: { status: result.status } })
			}

			const code = result.status === "created" ? 201 : 200
			return status(code, { success: true, data: result })
		})
		.use(signedRequest)
		.post("/", async ({ env, keyId, userId, signedPayload, status }) => {
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) {
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			}

			const validation = validateRequestFields(signedPayload)
			if (!validation.ok) {
				return status(400, fieldErrorBody(validation.code))
			}
			const { videoId, song, artist } = validation.fields

			const user = await getUserById(env, userId)
			const weight = user?.reputation ?? 1.0

			const result = await createRequest(env, {
				videoId,
				song,
				artist,
				thumbnailUrl: readThumbnailUrl(signedPayload),
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
