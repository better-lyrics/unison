import { config } from "@/config"
import { AVATAR_PRESETS, findPreset } from "@/db/avatar-presets"
import { getByKeyId } from "@/db/discordLinks"
import { clearAvatarChoice, resolveAvatarUrl, setAvatarChoice } from "@/db/users"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia } from "elysia"

export const avatarRoutes = (env: Env) =>
	new Elysia({ prefix: "/avatars" })
		.decorate("env", env)
		.use(readRateLimit)
		.get("/", ({ set }) => {
			set.headers["cache-control"] = "public, max-age=3600"
			return {
				success: true,
				data: {
					presets: AVATAR_PRESETS.map((p) => ({
						id: p.id,
						label: p.label,
						url: config.avatar.cdnBase + p.file,
					})),
					display: { cdnBase: config.avatar.cdnBase },
				},
			}
		})
		.use(
			new Elysia()
				.decorate("env", env)
				.use(eitherAuth)
				.put("/me", async ({ env, keyId, body, set }) => {
					const { success } = await env.RATE_LIMITER.limit({
						key: `avatar_write:${keyId}`,
						maxRequests: config.avatar.write.maxRequests,
						windowSeconds: config.avatar.write.windowSeconds,
					})
					if (!success) {
						set.status = 429
						return { success: false, error: "RATE_LIMITED" }
					}

					const { type, ref } = body as { type?: unknown; ref?: unknown }
					if (type === "default") {
						await clearAvatarChoice(env, keyId)
					} else if (type === "preset") {
						if (typeof ref !== "string" || !findPreset(ref)) {
							set.status = 400
							return { success: false, error: "UNKNOWN_PRESET" }
						}
						await setAvatarChoice(env, keyId, "preset", ref)
					} else if (type === "discord") {
						const link = await getByKeyId(env, keyId)
						if (!link?.discord_avatar) {
							set.status = 409
							return { success: false, error: "DISCORD_AVATAR_UNAVAILABLE" }
						}
						await setAvatarChoice(env, keyId, "discord", null)
					} else {
						set.status = 400
						return { success: false, error: "INVALID_TYPE" }
					}

					return { success: true, data: { avatarUrl: await resolveAvatarUrl(env, keyId) } }
				})
		)
