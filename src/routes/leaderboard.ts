import { Elysia, t } from "elysia"
import { config } from "@/config"
import {
	getCuratorLeaderboard,
	getCuratorRank,
	getMostWantedPage,
	getSongLeaderboard,
	getSongRank,
	type MostWantedCursor,
} from "@/db/leaderboard"
import { getLastVoteAt } from "@/db/profile"
import type { Env } from "@/types"
import { buildError, ErrorCode } from "@/utils/errors"
import { generatePetName } from "@/utils/petname"
import { readRateLimit } from "@/utils/read-rate-limit"

const SONGS_CACHE_KEY = "leaderboard:songs"
const QUEUE_FIRST_PAGE_CACHE_KEY_PREFIX = "leaderboard:songs:queue:first"
const USERS_CACHE_KEY = "leaderboard:users"
const QUEUE_DEFAULT_LIMIT = 20
const QUEUE_MAX_LIMIT = 50
const QUEUE_MIN_LIMIT = 1

function clampQueueLimit(raw: string | undefined): number {
	if (raw === undefined) return QUEUE_DEFAULT_LIMIT
	const parsed = Number.parseInt(raw, 10)
	if (!Number.isFinite(parsed)) return QUEUE_DEFAULT_LIMIT
	return Math.max(QUEUE_MIN_LIMIT, Math.min(QUEUE_MAX_LIMIT, parsed))
}

function encodeCursor(cursor: MostWantedCursor): string {
	return btoa(JSON.stringify(cursor))
}

function decodeCursor(raw: string): MostWantedCursor | null | "empty" {
	if (raw === "") return "empty"
	try {
		const parsed = JSON.parse(atob(raw)) as unknown
		if (!parsed || typeof parsed !== "object") return null
		const o = parsed as Record<string, unknown>
		if (
			typeof o.demand !== "number" ||
			typeof o.videoId !== "string" ||
			typeof o.cutoff !== "number" ||
			typeof o.lastRank !== "number"
		) {
			return null
		}
		return { demand: o.demand, videoId: o.videoId, cutoff: o.cutoff, lastRank: o.lastRank }
	} catch {
		return null
	}
}

export const leaderboardRoutes = (env: Env) =>
	new Elysia({ prefix: "/leaderboard" })
		.decorate("env", env)
		.use(readRateLimit)
		.get(
			"/songs",
			async ({ env, query, status }) => {
				if (query.cursor !== undefined) {
					const limit = clampQueueLimit(query.limit)
					const decoded = decodeCursor(query.cursor)
					if (decoded === null) {
						return status(400, buildError(ErrorCode.INVALID_CURSOR))
					}
					const cursor = decoded === "empty" ? null : decoded
					const cacheKey =
						cursor === null ? `${QUEUE_FIRST_PAGE_CACHE_KEY_PREFIX}:${limit}` : null
					if (cacheKey) {
						const cached = await env.CACHE.get(cacheKey)
						if (cached) {
							try {
								return JSON.parse(cached)
							} catch {
								await env.CACHE.delete(cacheKey)
							}
						}
					}
					const { items, nextCursor } = await getMostWantedPage(env, cursor, limit)
					const payload = {
						success: true,
						data: items,
						nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
					}
					if (cacheKey) {
						await env.CACHE.put(cacheKey, JSON.stringify(payload), {
							expirationTtl: config.requests.leaderboard.cacheTtl,
						})
					}
					return payload
				}

				const cached = await env.CACHE.get(SONGS_CACHE_KEY)
				if (cached) {
					try {
						return { success: true, data: JSON.parse(cached) }
					} catch {
						await env.CACHE.delete(SONGS_CACHE_KEY)
					}
				}
				const data = await getSongLeaderboard(env, config.requests.leaderboard.topN)
				await env.CACHE.put(SONGS_CACHE_KEY, JSON.stringify(data), {
					expirationTtl: config.requests.leaderboard.cacheTtl,
				})
				return { success: true, data }
			},
			{ query: t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) }
		)
		.get("/users", async ({ env }) => {
			const cached = await env.CACHE.get(USERS_CACHE_KEY)
			if (cached) {
				try {
					return { success: true, data: JSON.parse(cached) }
				} catch {
					await env.CACHE.delete(USERS_CACHE_KEY)
				}
			}
			const rows = await getCuratorLeaderboard(env, config.requests.leaderboard.topN)
			const curators = rows.map((r) => ({ ...r, displayName: generatePetName(r.keyId) }))
			const data = { curators }
			await env.CACHE.put(USERS_CACHE_KEY, JSON.stringify(data), {
				expirationTtl: config.requests.leaderboard.cacheTtl,
			})
			return { success: true, data }
		})
		.get(
			"/songs/:videoId",
			async ({ params, env }) => {
				const rank = await getSongRank(env, params.videoId)
				return rank
					? { success: true, data: { ranked: true, ...rank } }
					: { success: true, data: { ranked: false } }
			},
			{ params: t.Object({ videoId: t.String() }) }
		)
		.get(
			"/users/:keyId",
			async ({ params, env }) => {
				const [row, lastVoteAt] = await Promise.all([
					getCuratorRank(env, params.keyId),
					getLastVoteAt(env, params.keyId),
				])
				const displayName = generatePetName(params.keyId)
				return row
					? {
							success: true,
							data: {
								ranked: true,
								...row,
								displayName,
								lastVoteAt,
							},
						}
					: {
							success: true,
							data: {
								ranked: false,
								keyId: params.keyId,
								displayName,
								lastVoteAt,
							},
						}
			},
			{ params: t.Object({ keyId: t.String({ pattern: "^[0-9a-fA-F]{64}$" }) }) }
		)
