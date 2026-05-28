import { config } from "@/config"
import { getMySubmissions } from "@/db/feed"
import { parseFeedFilters } from "@/db/feed-filters"
import {
	findBySongArtist,
	findByVideoId,
	findVariantsByVideoId,
	getLyricsById,
	searchByQuery,
	searchBySongArtist,
	softDeleteLyrics,
	submitLyrics,
} from "@/db/lyrics"
import { getUserVote, getUserVotesForIds } from "@/db/votes"
import { Logger } from "@/infra/logger"
import { toFeedResponse } from "@/routes/feed"
import { toResponse, toSearchResponse } from "@/routes/lyrics.transformers"
import type { Env, LyricsSubmission } from "@/types"
import { signedRequest } from "@/utils/auth"
import { buildError, ErrorCode } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { detectFormat, detectSyncType, validateTtmlStructure } from "@/utils/validation"
import { Elysia, t } from "elysia"

const log = new Logger("app")

function parseDuration(raw: string | undefined): number | undefined {
	if (!raw) return undefined
	const n = Number(raw)
	if (!Number.isFinite(n)) return undefined
	const rounded = Math.round(n)
	if (rounded < config.validation.duration.min || rounded > config.validation.duration.max) {
		return undefined
	}
	return rounded
}

export const lyricsRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.use(readRateLimit)
		.derive({ as: "scoped" }, async ({ headers, env }) => {
			const keyId = headers["x-key-id"]
			if (!keyId) return { lyricsUserId: null as number | null }
			const user = await env.DB.prepare("SELECT id FROM users WHERE key_id = ?")
				.bind(keyId)
				.first<{ id: number }>()
			return { lyricsUserId: user?.id ?? null }
		})
		.get(
			"/",
			async ({ query, env, lyricsUserId, status }) => {
				if (query.v) {
					const result = await findByVideoId(env, query.v)
					if (!result) {
						return status(404, buildError(ErrorCode.NOT_FOUND))
					}
					const userVote = lyricsUserId ? await getUserVote(env, result.id, lyricsUserId) : null
					return { success: true, data: { ...toResponse(result), userVote } }
				}

				if (query.song && query.artist) {
					const duration = parseDuration(query.duration)
					const result = await findBySongArtist(
						env,
						query.song,
						query.artist,
						duration,
						query.album
					)
					if (!result) {
						return status(404, buildError(ErrorCode.NOT_FOUND))
					}
					const userVote = lyricsUserId ? await getUserVote(env, result.id, lyricsUserId) : null
					return { success: true, data: { ...toResponse(result), userVote } }
				}

				return status(400, buildError(ErrorCode.MISSING_QUERY))
			},
			{
				query: t.Object({
					v: t.Optional(t.String()),
					song: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					duration: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/search",
			async ({ query, env, status }) => {
				const limit = Math.min(
					Math.max(1, query.limit ? Number(query.limit) : config.search.defaultLimit),
					config.search.maxLimit
				)

				if (query.q) {
					const results = await searchByQuery(env, query.q, limit)
					log.info("query search", {
						query_length: query.q.length,
						result_count: results.length,
						top_tier: results[0]?.tier,
						top_match_score: results[0]?.match_score,
					})
					return { success: true, data: results.map(toSearchResponse) }
				}

				if (query.song && query.artist) {
					const duration = parseDuration(query.duration)
					const results = await searchBySongArtist(
						env,
						query.song,
						query.artist,
						duration,
						query.album,
						limit
					)
					return { success: true, data: results.map(toResponse) }
				}

				return status(400, buildError(ErrorCode.MISSING_QUERY, {
					hint: "Provide 'q' for fuzzy search, or both 'song' and 'artist' for exact match.",
				}))
			},
			{
				query: t.Object({
					q: t.Optional(t.String()),
					song: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					duration: t.Optional(t.String()),
					limit: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/variants/:videoId",
			async ({ params, query, env, status }) => {
				const parsed = query.limit ? Number(query.limit) : 10
				const limit = Math.min(Math.max(1, Number.isNaN(parsed) ? 10 : parsed), 50)
				const results = await findVariantsByVideoId(env, params.videoId, limit)
				if (results.length === 0) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				return { success: true, data: results.map(toResponse) }
			},
			{
				params: t.Object({ videoId: t.String() }),
				query: t.Object({
					limit: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/mine",
			async ({ query, env, lyricsUserId, status }) => {
				if (!lyricsUserId) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}

				const parsed = query.limit ? Number(query.limit) : 20
				const limit = Math.min(Math.max(1, Number.isNaN(parsed) ? 20 : parsed), 50)

				const parsedCursor = query.cursor ? Number(query.cursor) : 0
				const offset = Number.isFinite(parsedCursor)
					? Math.floor(Math.max(0, parsedCursor))
					: 0

				const filters = parseFeedFilters(query)

				const items = await getMySubmissions(env, lyricsUserId, limit, offset, filters)

				const votesMap = await getUserVotesForIds(
					env,
					items.map((i) => i.id),
					lyricsUserId
				)

				const nextCursor = items.length === limit ? offset + items.length : undefined

				return {
					success: true,
					data: items.map((item) => ({
						...toFeedResponse(item),
						userVote: votesMap.get(item.id) ?? null,
					})),
					nextCursor,
				}
			},
			{
				query: t.Object({
					limit: t.Optional(t.String()),
					cursor: t.Optional(t.String()),
					sort: t.Optional(t.String()),
					sortDir: t.Optional(t.String()),
					syncType: t.Optional(t.String()),
					format: t.Optional(t.String()),
					tier: t.Optional(t.String()),
					language: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/:id",
			async ({ params, env, lyricsUserId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const result = await getLyricsById(env, id)
				if (!result) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}

				const userVote = lyricsUserId ? await getUserVote(env, result.id, lyricsUserId) : null
				return { success: true, data: { ...toResponse(result), userVote } }
			},
			{
				params: t.Object({ id: t.String() }),
			}
		)
		.use(signedRequest)
		.post("/submit", async ({ env, keyId, userId, signedPayload, status }) => {
			const { success } = await env.RATE_LIMITER.limit({ key: keyId })
			if (!success) {
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			}

			const p = signedPayload
			if (
				typeof p.videoId !== "string" ||
				!p.videoId ||
				typeof p.song !== "string" ||
				!p.song ||
				typeof p.artist !== "string" ||
				!p.artist ||
				typeof p.duration !== "number" ||
				typeof p.lyrics !== "string" ||
				!p.lyrics ||
				typeof p.format !== "string" ||
				!["ttml", "lrc", "plain"].includes(p.format)
			) {
				return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			}

			if ((p.song as string).length > config.validation.song.maxLength) {
				return status(400, buildError(ErrorCode.SONG_TOO_LONG))
			}
			if ((p.artist as string).length > config.validation.artist.maxLength) {
				return status(400, buildError(ErrorCode.ARTIST_TOO_LONG))
			}
			if ((p.lyrics as string).length > config.validation.ttml.maxSizeBytes) {
				return status(400, buildError(ErrorCode.PAYLOAD_TOO_LARGE))
			}
			if (
				(p.duration as number) < config.validation.duration.min ||
				(p.duration as number) > config.validation.duration.max
			) {
				return status(400, buildError(ErrorCode.INVALID_DURATION))
			}

			const claimedFormat = p.format as "ttml" | "lrc" | "plain"
			const lyricsContent = p.lyrics as string

			if (claimedFormat === "ttml" && !validateTtmlStructure(lyricsContent)) {
				log.warn("rejecting malformed ttml claim", {
					keyId,
					videoId: p.videoId as string,
				})
				return status(400, buildError(ErrorCode.TTML_MALFORMED))
			}

			const format = detectFormat(lyricsContent)

			if (claimedFormat !== format) {
				log.warn("format mismatch, overriding with detected", {
					keyId,
					videoId: p.videoId as string,
					claimed: claimedFormat,
					detected: format,
				})
			}

			const detectedSyncType = detectSyncType(lyricsContent, format)

			const claimedSyncType =
				typeof p.syncType === "string" && ["richsync", "linesync", "plain"].includes(p.syncType)
					? (p.syncType as "richsync" | "linesync" | "plain")
					: undefined

			if (claimedSyncType && claimedSyncType !== detectedSyncType) {
				log.warn("syncType mismatch, overriding with detected", {
					keyId,
					videoId: p.videoId as string,
					format,
					claimed: claimedSyncType,
					detected: detectedSyncType,
				})
			}

			const submission: LyricsSubmission = {
				videoId: p.videoId as string,
				song: p.song as string,
				artist: p.artist as string,
				album: typeof p.album === "string" ? p.album : undefined,
				isrc: typeof p.isrc === "string" ? p.isrc : undefined,
				duration: p.duration as number,
				lyrics: p.lyrics as string,
				format,
				language: typeof p.language === "string" ? p.language : undefined,
				syncType: detectedSyncType,
			}

			const result = await submitLyrics(env, submission, userId)

			if (!result.created) {
				return status(409, buildError(ErrorCode.VARIANT_CAP_REACHED))
			}

			return status(201, {
				success: true,
				data: result,
			})
		})
		.delete(
			"/:id",
			async ({ params, env, userId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const result = await softDeleteLyrics(env, id, userId, "submitter")

				if (result.deleted) {
					return { success: true }
				}
				if (result.reason === "forbidden") {
					return status(403, buildError(ErrorCode.NOT_OWNER))
				}
				return status(404, buildError(ErrorCode.NOT_FOUND))
			},
			{ params: t.Object({ id: t.String() }) }
		)
