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
	if (variant === "silhouette") return `${def.key}_silhouette.svg`
	if (variant === "mono") return `${def.key}_mono.svg`
	if (!def.tiers) return `${def.key}.svg`
	const parsed = Number.parseInt(tier ?? "", 10)
	const level = Number.isInteger(parsed) && parsed >= 1 && parsed <= def.tiers.length ? parsed : 1
	return `${def.key}_${level}.svg`
}

// The silhouette is a solid fill of each badge's exact shape. Used as an alpha mask, it lets
// us paint a shape-following background of any color behind the art (no rectangle, no edge clip).
const silhouetteImageCache = new Map<string, string | null>()

function silhouetteMaskImage(key: string): string | null {
	const cached = silhouetteImageCache.get(key)
	if (cached !== undefined) return cached
	let image: string | null = null
	try {
		const svg = readFileSync(join(ASSETS_DIR, `${key}_silhouette.svg`), "utf-8")
		const match = svg.match(/<image\b[^>]*?\/>/s)
		image = match ? match[0].replace(/\s+xlink:href="[^"]*"/g, "") : null
	} catch {
		image = null
	}
	silhouetteImageCache.set(key, image)
	return image
}

// null means "no background": return the raw transparent art.
function resolveBackground(bg?: string): string | null {
	if (bg === "none") return null
	if (!bg || bg === "black") return "#000000"
	if (bg === "white") return "#ffffff"
	if (/^#[0-9a-fA-F]{3,8}$/.test(bg)) return bg
	return "#000000"
}

function bakeBackground(art: string, key: string, color: string): string {
	const image = silhouetteMaskImage(key)
	if (!image) return art
	const layer = `<mask id="unison-badge-bg" mask-type="alpha" style="mask-type:alpha">${image}</mask><rect width="100%" height="100%" fill="${color}" mask="url(#unison-badge-bg)"/>`
	return art.replace(/(<svg\b[^>]*>)/, `$1${layer}`)
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
				if (query.variant !== "silhouette") {
					const bg = resolveBackground(query.bg)
					if (bg) svg = bakeBackground(svg, def.key, bg)
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
					bg: t.Optional(t.String()),
					v: t.Optional(t.String()),
				}),
			}
		)
