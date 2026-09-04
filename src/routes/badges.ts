import { config } from "@/config"
import { CATALOGUE } from "@/db/badges/definitions"
import type { Env } from "@/types"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia } from "elysia"

export const badgeRoutes = (env: Env) =>
	new Elysia({ prefix: "/badges" })
		.decorate("env", env)
		.use(readRateLimit)
		.get("/", ({ set }) => {
			set.headers["cache-control"] = "public, max-age=3600"
			return {
				success: true,
				data: {
					badges: CATALOGUE,
					display: {
						inlineGlyphs: config.gamification.display.inlineGlyphs,
						featuredMax: config.gamification.featured.maxSlots,
						rarityThreshold: config.gamification.display.rarityThreshold,
						categoryOrder: [...config.gamification.display.categoryOrder],
					},
				},
			}
		})
