import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import { resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const NEVER = () => 1

function makeMapCache() {
	const store = new Map<string, string>()
	return {
		store,
		async get(k: string): Promise<string | null> {
			return store.has(k) ? (store.get(k) as string) : null
		},
		async put(k: string, v: string): Promise<void> {
			store.set(k, v)
		},
		async delete(k: string): Promise<void> {
			store.delete(k)
		},
	}
}

describeIntegration("resolveArtwork (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let cache: ReturnType<typeof makeMapCache>
	let env: Env

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		await pool.query("DELETE FROM song_artwork")
		cache = makeMapCache()
		env = { DB: new D1Compat(pool), CACHE: cache } as unknown as Env
	})

	it("resolves via the resolver on a cold miss and caches to DB + Redis", async () => {
		const resolver = vi.fn(async () => "https://art/x=w544-h544")
		const url = await resolveArtwork(env, "v1", { resolver, random: NEVER })
		expect(url).toBe("https://art/x=w544-h544")
		expect(resolver).toHaveBeenCalledTimes(1)
		expect(cache.store.get("artwork:v1")).toBe("https://art/x=w544-h544")

		const again = await resolveArtwork(env, "v1", { resolver, random: NEVER })
		expect(again).toBe("https://art/x=w544-h544")
		expect(resolver).toHaveBeenCalledTimes(1)
	})

	it("serves a DB hit without the resolver and warms Redis", async () => {
		await upsertVideoArtwork(env, "v2", "https://art/db=w544-h544")
		const resolver = vi.fn(async () => "https://should-not-be-called")
		expect(await resolveArtwork(env, "v2", { resolver, random: NEVER })).toBe(
			"https://art/db=w544-h544"
		)
		expect(resolver).not.toHaveBeenCalled()
		expect(cache.store.get("artwork:v2")).toBe("https://art/db=w544-h544")
	})

	describe("edge cases", () => {
		it("negative-caches a null result", async () => {
			const resolver = vi.fn(async () => null)
			expect(await resolveArtwork(env, "v3", { resolver, random: NEVER })).toBeNull()
			expect(await resolveArtwork(env, "v3", { resolver, random: NEVER })).toBeNull()
			expect(resolver).toHaveBeenCalledTimes(1)
			expect(cache.store.get("artwork:v3")).toBe("__none__")
		})

		it("serves a negative Redis hit as null", async () => {
			cache.store.set("artwork:v4", "__none__")
			const resolver = vi.fn(async () => "https://should-not-be-called")
			expect(await resolveArtwork(env, "v4", { resolver, random: NEVER })).toBeNull()
			expect(resolver).not.toHaveBeenCalled()
		})
	})

	describe("probabilistic refresh", () => {
		it("re-resolves and updates cache + DB when random triggers", async () => {
			await upsertVideoArtwork(env, "v5", "https://old=w544-h544")
			cache.store.set("artwork:v5", "https://old=w544-h544")
			const resolver = vi.fn(async () => "https://new=w544-h544")
			const ALWAYS = () => 0

			const served = await resolveArtwork(env, "v5", { resolver, random: ALWAYS })
			expect(served).toBe("https://old=w544-h544")
			await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
			await vi.waitFor(() => expect(cache.store.get("artwork:v5")).toBe("https://new=w544-h544"))
		})

		it("regression: does not clobber existing artwork when the refresh resolves null", async () => {
			await upsertVideoArtwork(env, "v6", "https://good=w544-h544")
			cache.store.set("artwork:v6", "https://good=w544-h544")
			const resolver = vi.fn(async () => null)
			const ALWAYS = () => 0

			const served = await resolveArtwork(env, "v6", { resolver, random: ALWAYS })
			expect(served).toBe("https://good=w544-h544")
			await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
			expect(cache.store.get("artwork:v6")).toBe("https://good=w544-h544")
			const row = await getVideoArtwork(env, "v6")
			expect(row?.artworkUrl).toBe("https://good=w544-h544")
		})
	})
})
