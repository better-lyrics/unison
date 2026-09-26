import { config } from "@/config"
import {
	addToCatalogue,
	deletePreset,
	findPreset,
	getPresets,
	insertPreset,
} from "@/db/avatar-presets"
import { getByKeyId } from "@/db/discordLinks"
import { hasSubmissionForVideo } from "@/db/profile"
import { clearAvatarChoice, resolveAvatarUrl, setAvatarChoice } from "@/db/users"
import { resolveArtwork } from "@/services/artwork"
import { AvatarImageError, formatAvatar } from "@/services/avatar-image"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { isVideoId } from "@/utils/video-id"
import { Elysia, t } from "elysia"

export const avatarRoutes = (env: Env) =>
	new Elysia({ prefix: "/avatars" })
		.decorate("env", env)
		.use(readRateLimit)
		.get("/", ({ set }) => {
			set.headers["cache-control"] = "public, max-age=3600"
			return {
				success: true,
				data: {
					presets: getPresets().map((p) => ({
						id: p.id,
						label: p.label,
						url: config.avatar.cdnBase + p.file,
					})),
					display: {
						cdnBase: config.avatar.cdnBase,
						artworkSize: config.avatar.artworkSize,
					},
				},
			}
		})
		.post(
			"/presets",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				if (!env.CDN) return status(503, buildError(ErrorCode.CDN_UNAVAILABLE))

				const { id, label, createdBy, mime, dataBase64 } = body
				const input = Buffer.from(dataBase64, "base64")
				if (input.length === 0) return status(422, buildError(ErrorCode.AVATAR_IMAGE_INVALID))

				let webp: Buffer
				try {
					webp = (await formatAvatar(input, mime)).webp
				} catch (err) {
					if (err instanceof AvatarImageError) {
						return status(422, buildError(ErrorCode.AVATAR_IMAGE_INVALID))
					}
					throw err
				}

				const file = `${id}.webp`
				// Reserve the id in the db before the CDN write, so a duplicate never overwrites a live
				// avatar and a failed upload leaves no row behind.
				if (
					(await insertPreset(env, { id, label, file, createdBy: createdBy ?? null })) === "exists"
				) {
					return status(409, buildError(ErrorCode.AVATAR_PRESET_EXISTS))
				}

				const key = config.avatar.cdnKeyPrefix + file
				try {
					await env.CDN.putObject(key, webp, "image/webp")
				} catch (err) {
					await deletePreset(env, id).catch(() => {})
					throw err
				}

				addToCatalogue({ id, label, file })
				return status(200, {
					success: true,
					data: { id, label, url: config.avatar.cdnBase + file },
				})
			},
			{
				body: t.Object({
					id: t.String({ pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 64 }),
					label: t.String({ minLength: 1, maxLength: 64 }),
					createdBy: t.Optional(t.String({ maxLength: 64 })),
					mime: t.String({ minLength: 1, maxLength: 64 }),
					dataBase64: t.String({ minLength: 1 }),
				}),
			}
		)
		.use(
			new Elysia()
				.decorate("env", env)
				.use(eitherAuth)
				.put("/me", async ({ env, keyId, body, status }) => {
					const { success } = await env.RATE_LIMITER.limit({
						key: `avatar_write:${keyId}`,
						maxRequests: config.avatar.write.maxRequests,
						windowSeconds: config.avatar.write.windowSeconds,
					})
					if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))

					const { type, ref } = body as { type?: unknown; ref?: unknown }
					if (type === "default") {
						await clearAvatarChoice(env, keyId)
					} else if (type === "preset") {
						if (typeof ref !== "string" || !findPreset(ref)) {
							return status(400, buildError(ErrorCode.UNKNOWN_AVATAR_PRESET))
						}
						await setAvatarChoice(env, keyId, "preset", ref)
					} else if (type === "discord") {
						const link = await getByKeyId(env, keyId)
						if (!link?.discord_avatar) {
							return status(409, buildError(ErrorCode.DISCORD_AVATAR_UNAVAILABLE))
						}
						await setAvatarChoice(env, keyId, "discord", link.discord_id)
					} else if (type === "song") {
						if (!isVideoId(ref)) {
							return status(400, buildError(ErrorCode.INVALID_AVATAR_TYPE))
						}
						if (!(await hasSubmissionForVideo(env, keyId, ref))) {
							return status(403, buildError(ErrorCode.SONG_NOT_SUBMITTED))
						}
						if (!(await resolveArtwork(env, ref))) {
							return status(409, buildError(ErrorCode.SONG_ARTWORK_UNAVAILABLE))
						}
						await setAvatarChoice(env, keyId, "song", ref)
					} else {
						return status(400, buildError(ErrorCode.INVALID_AVATAR_TYPE))
					}

					return { success: true, data: { avatarUrl: await resolveAvatarUrl(env, keyId) } }
				})
		)
