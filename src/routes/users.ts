import { config } from "@/config"
import { getUserBadges, setFeatured } from "@/db/badges"
import { getFulfillmentStatsBySubmitter } from "@/db/fulfillments"
import { getSubmissionsByUser } from "@/db/profile"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia, t } from "elysia"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function parseCursor(raw: string): { createdAt: number; id: number } {
	const [createdAtStr, idStr] = raw.split(":")
	return { createdAt: Number(createdAtStr), id: Number(idStr) }
}

function parseFeaturedKeys(body: unknown): string[] | null {
	if (!body || typeof body !== "object") return null
	const featured = (body as { featured?: unknown }).featured
	if (!Array.isArray(featured) || !featured.every((k) => typeof k === "string")) return null
	return featured
}

export const userRoutes = (env: Env) =>
	new Elysia({ prefix: "/users" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/:keyId/submissions",
			async ({ params, query, env }) => {
				const limit = query.limit ?? DEFAULT_LIMIT
				const cursor = query.cursor ? parseCursor(query.cursor) : null

				const rows = await getSubmissionsByUser(env, params.keyId, limit + 1, cursor)

				const hasMore = rows.length > limit
				const submissions = hasMore ? rows.slice(0, limit) : rows
				const data: {
					submissions: typeof submissions
					nextCursor?: string
				} = { submissions }
				if (hasMore) {
					const last = submissions[submissions.length - 1]
					data.nextCursor = `${last.createdAt}:${last.id}`
				}

				return { success: true, data }
			},
			{
				params: t.Object({ keyId: t.String({ pattern: "^[0-9a-fA-F]{64}$" }) }),
				query: t.Object({
					limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_LIMIT })),
					cursor: t.Optional(t.String({ pattern: "^[0-9]+:[0-9]+$" })),
				}),
			}
		)
		.get(
			"/:keyId/stats",
			async ({ params, env, status }) => {
				const user = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
					.bind(params.keyId)
					.first<{ id: number }>()
				if (!user) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				const stats = await getFulfillmentStatsBySubmitter(env, user.id)
				return { success: true, data: stats }
			},
			{ params: t.Object({ keyId: t.String({ pattern: "^[0-9a-fA-F]{64}$" }) }) }
		)
		.get(
			"/:keyId/badges",
			async ({ params, env }) => ({
				success: true,
				data: await getUserBadges(env, params.keyId),
			}),
			{ params: t.Object({ keyId: t.String({ pattern: "^[0-9a-fA-F]{64}$" }) }) }
		)
		.use(eitherAuth)
		.put("/me/featured-badges", async ({ env, keyId, userId, body, status }) => {
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))

			const featured = parseFeaturedKeys(body)
			if (!featured) return status(400, buildError(ErrorCode.INVALID_FEATURED_BADGES))

			const result = await setFeatured(env, userId, featured)
			if (!result.ok) {
				const hint =
					result.reason === "over_cap"
						? `You can feature up to ${config.gamification.featured.maxSlots} badges. Remove some and try again.`
						: "You can only feature badges you've earned."
				return status(400, buildError(ErrorCode.INVALID_FEATURED_BADGES, { hint }))
			}
			return { success: true, data: result.gamification }
		})
