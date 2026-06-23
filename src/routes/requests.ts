import { timingSafeEqual } from "node:crypto"
import { Elysia } from "elysia"
import { config } from "@/config"
import { createRequest } from "@/db/requests"
import { getUserById, getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"
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

function extractBearer(header: unknown): string | null {
	if (typeof header !== "string") return null
	const match = /^Bearer (.+)$/.exec(header)
	return match ? match[1] : null
}

function secretsMatch(provided: string, expected: string): boolean {
	const a = Buffer.from(provided)
	const b = Buffer.from(expected)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

export const requestRoutes = (env: Env) =>
	new Elysia({ prefix: "/requests" })
		.decorate("env", env)
		.post("/bot", async ({ env, headers, body, status }) => {
			const secret = env.BUTLER_BOT_SECRET
			const provided = extractBearer(headers.authorization)
			if (!secret || !provided || !secretsMatch(provided, secret)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}

			const b = (body ?? {}) as Record<string, unknown>
			const validation = validateRequestFields(b)
			if (!validation.ok) {
				return status(400, fieldErrorBody(validation.code))
			}
			const { videoId, song, artist } = validation.fields

			const keyId = typeof b.keyId === "string" && b.keyId ? b.keyId : null
			const requesterIdInput =
				typeof b.requesterId === "string" && b.requesterId ? b.requesterId : null
			if (!keyId && !requesterIdInput) {
				return status(
					400,
					buildError(ErrorCode.INVALID_PAYLOAD, { error: "keyId or requesterId required" })
				)
			}

			const requesterId = keyId ?? (requesterIdInput as string)
			const { success } = await env.RATE_LIMITER.limit({ key: requesterId })
			if (!success) {
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			}

			let weight: number = config.requests.discordNeutralWeight
			if (keyId) {
				const user = await getUserByKeyId(env, keyId)
				weight = user?.reputation ?? config.requests.discordNeutralWeight
			}

			const result = await createRequest(env, {
				videoId,
				song,
				artist,
				thumbnailUrl: readThumbnailUrl(b),
				requesterId,
				requesterType: "discord",
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
