import { config } from "@/config"
import { fetchArtworkImage, resolveArtworkCover } from "@/services/artwork"
import type { Env } from "@/types"
import { normalizeArtworkUrl } from "@/utils/artwork"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { isVideoId } from "@/utils/video-id"
import { Elysia, t } from "elysia"

export const artworkRoutes = (env: Env) =>
	new Elysia({ prefix: "/artwork" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/",
			async ({ env, query, status }) => {
				if (!query.v) return status(400, buildError(ErrorCode.MISSING_QUERY))
				if (!isVideoId(query.v)) return status(400, buildError(ErrorCode.INVALID_ID))
				const cover = await resolveArtworkCover(env, query.v)
				const artworkUrl =
					cover && query.size ? normalizeArtworkUrl(cover.url, query.size) : cover?.url
				return {
					success: true,
					data: {
						artworkUrl: artworkUrl ?? null,
						...(cover?.fallbackUrl ? { fallbackUrl: cover.fallbackUrl } : {}),
					},
				}
			},
			{
				query: t.Object({
					v: t.Optional(t.String()),
					size: t.Optional(t.Integer({ minimum: 32, maximum: 2048 })),
				}),
			}
		)
		.get(
			"/image",
			async ({ env, query, status, set }) => {
				if (!isVideoId(query.v)) return status(400, buildError(ErrorCode.INVALID_ID))
				const cover = await resolveArtworkCover(env, query.v)
				const image = cover ? await fetchArtworkImage(cover, config.artwork.washSize) : null
				if (!image) {
					set.headers["cache-control"] = cover ? "public, max-age=60" : "public, max-age=3600"
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				return new Response(new Uint8Array(image.bytes), {
					headers: {
						"content-type": image.type,
						"cache-control": config.artwork.imageCacheControl,
					},
				})
			},
			{ query: t.Object({ v: t.String() }) }
		)
