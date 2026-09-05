import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "@/config"
import { type BadgeDef, CATALOGUE } from "@/db/badges/definitions"
import type { Env } from "@/types"
import { ErrorCode, buildError } from "@/utils/errors"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia, t } from "elysia"

const ASSETS_DIR = fileURLToPath(new URL("../../assets/badges/", import.meta.url))

function resolveImageFilename(def: BadgeDef, variant?: string, tier?: string): string {
	if (variant === "mono") return `${def.key}_mono.svg`
	if (!def.tiers) return `${def.key}.svg`
	const parsed = Number.parseInt(tier ?? "", 10)
	const level = Number.isInteger(parsed) && parsed >= 1 && parsed <= def.tiers.length ? parsed : 1
	return `${def.key}_${level}.svg`
}

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
				const def = CATALOGUE.find((b) => b.key === params.key)
				if (!def) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				const filename = resolveImageFilename(def, query.variant, query.tier)
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
