import { Elysia, t } from "elysia"
import { getSubmissionsByUser } from "@/db/profile"
import type { Env } from "@/types"
import { readRateLimit } from "@/utils/read-rate-limit"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export const userRoutes = (env: Env) =>
	new Elysia({ prefix: "/users" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/:keyId/submissions",
			async ({ params, query, env }) => {
				const limit = query.limit ?? DEFAULT_LIMIT
				const cursor = query.cursor ?? null

				const rows = await getSubmissionsByUser(env, params.keyId, limit + 1, cursor)

				const hasMore = rows.length > limit
				const submissions = hasMore ? rows.slice(0, limit) : rows
				const data: {
					submissions: typeof submissions
					nextCursor?: number
				} = { submissions }
				if (hasMore) data.nextCursor = submissions[submissions.length - 1].createdAt

				return { success: true, data }
			},
			{
				params: t.Object({ keyId: t.String() }),
				query: t.Object({
					limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_LIMIT })),
					cursor: t.Optional(t.Numeric({ minimum: 0 })),
				}),
			}
		)
