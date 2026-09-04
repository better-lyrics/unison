import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "@/config"
import { CATALOGUE } from "@/db/badges/definitions"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia, t } from "elysia"

const VALID_KEYS = new Set(CATALOGUE.map((b) => b.key))
const ASSETS_DIR = fileURLToPath(new URL("../../assets/badges/", import.meta.url))

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
		.get(
			"/:key/image.svg",
			({ params, query, status }) => {
				if (!VALID_KEYS.has(params.key)) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				const filename = `${params.key}${query.variant === "mono" ? "_mono" : ""}.svg`
				let svg: string
				try {
					svg = readFileSync(join(ASSETS_DIR, filename), "utf-8")
				} catch {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				return new Response(svg, {
					headers: {
						"content-type": "image/svg+xml; charset=utf-8",
						"cache-control": "public, max-age=31536000, immutable",
					},
				})
			},
			{
				params: t.Object({ key: t.String({ pattern: "^[a-z0-9-]+$" }) }),
				query: t.Object({
					variant: t.Optional(t.String()),
					tier: t.Optional(t.String()),
					v: t.Optional(t.String()),
				}),
			}
		)
