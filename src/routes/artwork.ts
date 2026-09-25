import { Elysia, t } from "elysia"
import { resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"
import { normalizeArtworkUrl } from "@/utils/artwork"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { isVideoId } from "@/utils/video-id"

export const artworkRoutes = (env: Env) =>
	new Elysia({ prefix: "/artwork" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/",
			async ({ env, query, status }) => {
				if (!query.v) return status(400, buildError(ErrorCode.MISSING_QUERY))
				if (!isVideoId(query.v)) return status(400, buildError(ErrorCode.INVALID_ID))
				const artworkUrl = await resolveArtwork(env, query.v)
				return {
					success: true,
					data: {
						artworkUrl:
							artworkUrl && query.size ? normalizeArtworkUrl(artworkUrl, query.size) : artworkUrl,
					},
				}
			},
			{
				query: t.Object({
					v: t.Optional(t.String()),
					size: t.Optional(t.Integer({ minimum: 32, maximum: 1024 })),
				}),
			}
		)
