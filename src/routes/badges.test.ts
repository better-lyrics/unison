import { config } from "@/config"
import { BADGES, TIER_BADGES } from "@/db/badges/definitions"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { badgeRoutes } from "./badges"

function makeEnv(): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const cache = {
		async get() {
			return null
		},
		async put() {},
		async delete() {},
		async keys() {
			return []
		},
		async setNX() {
			return true
		},
	}
	return {
		DB: {} as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

interface BadgeEntry {
	key: string
	image: { color: string; mono: string }
}

interface CatalogueBody {
	success: boolean
	data: {
		badges: BadgeEntry[]
		display: {
			inlineGlyphs: number
			featuredMax: number
			rarityThreshold: number
			categoryOrder: string[]
		}
	}
}

describe("GET /badges", () => {
	it("returns the catalogue with display metadata", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as CatalogueBody
		expect(json.success).toBe(true)
		expect(json.data.display.featuredMax).toBe(config.gamification.featured.maxSlots)
		expect(json.data.display.inlineGlyphs).toBe(config.gamification.display.inlineGlyphs)
		expect(json.data.display.rarityThreshold).toBe(config.gamification.display.rarityThreshold)
		expect(json.data.display.categoryOrder.length).toBeGreaterThan(0)
	})

	it("exposes every renderable mark: the nine badges and five tier titles", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges"))
		const json = (await res.json()) as CatalogueBody
		const keys = json.data.badges.map((b) => b.key)
		for (const key of [...BADGES, ...TIER_BADGES].map((b) => b.key)) {
			expect(keys).toContain(key)
		}
		expect(keys.length).toBe(14)
	})

	it("gives every entry resolvable color and mono image URLs", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges"))
		const json = (await res.json()) as CatalogueBody
		for (const b of json.data.badges) {
			expect(b.image.color).toBe(`/badges/${b.key}/image.svg?variant=color`)
			expect(b.image.mono).toBe(`/badges/${b.key}/image.svg?variant=mono`)
		}
	})

	it("sets a cache-friendly header", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges"))
		expect(res.headers.get("cache-control")).toContain("max-age")
	})
})
