import { Elysia, t } from "elysia"
import { resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"

export const artworkRoutes = (env: Env) =>
	new Elysia({ prefix: "/artwork" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/",
			async ({ env, query, status }) => {
				if (!query.v) return status(400, buildError(ErrorCode.MISSING_QUERY))
				if (!/^[A-Za-z0-9_-]{11}$/.test(query.v))
					return status(400, buildError(ErrorCode.INVALID_ID))
				const artworkUrl = await resolveArtwork(env, query.v)
				return { success: true, data: { artworkUrl } }
			},
			{ query: t.Object({ v: t.Optional(t.String()) }) }
		)
