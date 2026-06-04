import { Elysia, t } from "elysia"
import { getFulfillmentStatsBySubmitter } from "@/db/fulfillments"
import { getSubmissionsByUser } from "@/db/profile"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function parseCursor(raw: string): { createdAt: number; id: number } {
	const [createdAtStr, idStr] = raw.split(":")
	return { createdAt: Number(createdAtStr), id: Number(idStr) }
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
