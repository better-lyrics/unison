import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getVideoArtwork, insertVideoArtworkIfAbsent, upsertVideoArtwork } from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("song_artwork db (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = {
			DB: new D1Compat(pool),
			CACHE: { delete: async () => {}, put: async () => {} },
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		await pool.query("DELETE FROM song_artwork")
	})

	it("returns null for an unknown video", async () => {
		expect(await getVideoArtwork(env, "vid00000001")).toBeNull()
	})

	it("upserts and reads back a url", async () => {
		await upsertVideoArtwork(env, "vid00000001", "https://art/1=w544-h544")
		const row = await getVideoArtwork(env, "vid00000001")
		expect(row?.artworkUrl).toBe("https://art/1=w544-h544")
	})

	it("upsert overwrites; insertIfAbsent does not", async () => {
		await insertVideoArtworkIfAbsent(env, "v", "https://art/a=w544-h544")
		await insertVideoArtworkIfAbsent(env, "v", "https://art/b=w544-h544")
		expect((await getVideoArtwork(env, "v"))?.artworkUrl).toBe("https://art/a=w544-h544")
		await upsertVideoArtwork(env, "v", "https://art/c=w544-h544")
		expect((await getVideoArtwork(env, "v"))?.artworkUrl).toBe("https://art/c=w544-h544")
	})

	describe("edge cases", () => {
		it("stores a negative (null) result as a present row", async () => {
			await upsertVideoArtwork(env, "vnone", null)
			const row = await getVideoArtwork(env, "vnone")
			expect(row).not.toBeNull()
			expect(row?.artworkUrl).toBeNull()
		})

		it("records a checked_at timestamp on write", async () => {
			const before = Math.floor(Date.now() / 1000)
			await upsertVideoArtwork(env, "vstamp", "https://art/s=w544-h544")
			const row = await getVideoArtwork(env, "vstamp")
			expect(row?.checkedAt).toBeGreaterThanOrEqual(before)
		})
	})
})
