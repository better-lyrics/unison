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

describe("GET /badges/:key/image.svg", () => {
	it("serves the color art for a known key", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges/most-loved/image.svg"))
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/)
		const body = await res.text()
		expect(body).toContain("<svg")
	})

	it("serves the mono art when variant=mono", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(
			new Request("http://localhost/badges/most-loved/image.svg?variant=mono")
		)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/)
	})

	it("serves a placeholder key that is not backed by real art", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges/committee/image.svg"))
		expect(res.status).toBe(200)
	})

	it("ignores tier and cache-busting query params", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(
			new Request("http://localhost/badges/legendary/image.svg?tier=3&v=abc")
		)
		expect(res.status).toBe(200)
	})

	async function bodyOf(app: ReturnType<typeof badgeRoutes>, url: string): Promise<string> {
		const res = await app.handle(new Request(url))
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/)
		return res.text()
	}

	it("serves distinct per-tier color art for a tiered key", async () => {
		const app = badgeRoutes(makeEnv())
		const base = "http://localhost/badges/verified-contributor/image.svg?variant=color"
		const t1 = await bodyOf(app, `${base}&tier=1`)
		const t2 = await bodyOf(app, `${base}&tier=2`)
		const t3 = await bodyOf(app, `${base}&tier=3`)
		expect(t1).toContain("<svg")
		expect(t1).not.toBe(t2)
		expect(t2).not.toBe(t3)
		expect(t1).not.toBe(t3)
	})

	it("ignores tier for the mono variant of a tiered key", async () => {
		const app = badgeRoutes(makeEnv())
		const withTier = await bodyOf(
			app,
			"http://localhost/badges/verified-contributor/image.svg?variant=mono&tier=3"
		)
		const noTier = await bodyOf(
			app,
			"http://localhost/badges/verified-contributor/image.svg?variant=mono"
		)
		expect(withTier).toBe(noTier)
	})

	it("defaults a tiered key with no tier param to tier 1", async () => {
		const app = badgeRoutes(makeEnv())
		const noTier = await bodyOf(
			app,
			"http://localhost/badges/verified-contributor/image.svg?variant=color"
		)
		const tier1 = await bodyOf(
			app,
			"http://localhost/badges/verified-contributor/image.svg?variant=color&tier=1"
		)
		expect(noTier).toBe(tier1)
	})

	it("clamps an out-of-range or non-numeric tier to tier 1", async () => {
		const app = badgeRoutes(makeEnv())
		const tier1 = await bodyOf(
			app,
			"http://localhost/badges/verified-contributor/image.svg?variant=color&tier=1"
		)
		for (const bad of ["99", "0", "abc"]) {
			const got = await bodyOf(
				app,
				`http://localhost/badges/verified-contributor/image.svg?variant=color&tier=${bad}`
			)
			expect(got).toBe(tier1)
		}
	})

	it("returns 404 for an unknown key", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(new Request("http://localhost/badges/nope/image.svg"))
		expect(res.status).toBe(404)
	})

	it("rejects a path traversal attempt", async () => {
		const app = badgeRoutes(makeEnv())
		const res = await app.handle(
			new Request("http://localhost/badges/..%2F..%2Fetc%2Fpasswd/image.svg")
		)
		expect(res.status).toBeGreaterThanOrEqual(400)
		expect(res.status).toBeLessThan(500)
	})
})
