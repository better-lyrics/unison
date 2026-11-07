import { readFileSync } from "node:fs"
import {
	fallbackBytesTotal,
	getVideoArtwork,
	insertVideoArtworkIfAbsent,
	leastServedFallbacks,
	setArtworkFallback,
	upsertVideoArtwork,
} from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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

	describe("fallback copies", () => {
		const COVER = "https://yt3.googleusercontent.com/a=w544-h544-l90-rj"
		const COPY = "https://cdn.betterlyrics.org/artwork/v-0123456789abcdef.jpg"

		it("keeps the copy while the cover stays the same and drops it when the cover changes", async () => {
			await upsertVideoArtwork(env, "v", COVER)
			expect(await setArtworkFallback(env, "v", COVER, COPY, 50_000)).toBe(true)
			await upsertVideoArtwork(env, "v", COVER)
			expect((await getVideoArtwork(env, "v"))?.fallbackUrl).toBe(COPY)

			await upsertVideoArtwork(env, "v", "https://yt3.googleusercontent.com/b=w544-h544-l90-rj")
			expect((await getVideoArtwork(env, "v"))?.fallbackUrl).toBeNull()
			expect(await fallbackBytesTotal(env)).toBe(0)
		})

		it("refuses a copy of a cover that changed while it was being made", async () => {
			await upsertVideoArtwork(env, "v", "https://yt3.googleusercontent.com/b=w544-h544-l90-rj")
			expect(await setArtworkFallback(env, "v", COVER, COPY, 50_000)).toBe(false)
			expect((await getVideoArtwork(env, "v"))?.fallbackUrl).toBeNull()
		})

		it("lists copies least recently served first", async () => {
			for (const [id, servedAt] of [
				["old", 100],
				["new", 300],
				["mid", 200],
			] as const) {
				await upsertVideoArtwork(env, id, COVER)
				await setArtworkFallback(env, id, COVER, `${COPY}?${id}`, 10)
				await pool.query("UPDATE song_artwork SET served_at = $1 WHERE video_id = $2", [
					servedAt,
					id,
				])
			}
			expect((await leastServedFallbacks(env, 3)).map((r) => r.videoId)).toEqual([
				"old",
				"mid",
				"new",
			])
		})
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
