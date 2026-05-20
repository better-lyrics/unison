import { Elysia, t } from "elysia"
import { config } from "@/config"
import {
	getCuratorLeaderboard,
	getCuratorRank,
	getSongLeaderboard,
	getSongRank,
} from "@/db/leaderboard"
import type { Env } from "@/types"
import { generatePetName } from "@/utils/petname"
import { readRateLimit } from "@/utils/read-rate-limit"

const SONGS_CACHE_KEY = "leaderboard:songs"
const USERS_CACHE_KEY = "leaderboard:users"

export const leaderboardRoutes = (env: Env) =>
	new Elysia({ prefix: "/leaderboard" })
		.decorate("env", env)
		.use(readRateLimit)
		.get("/songs", async ({ env }) => {
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
		})
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
				const row = await getCuratorRank(env, params.keyId)
				return row
					? {
							success: true,
							data: { ranked: true, ...row, displayName: generatePetName(row.keyId) },
						}
					: { success: true, data: { ranked: false } }
			},
			{ params: t.Object({ keyId: t.String() }) }
		)
