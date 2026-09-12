import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getVideoArtwork } from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import { backfillArtwork } from "@/jobs/backfill-artwork"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("backfill artwork (integration)", () => {
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
		await pool.query("DELETE FROM requested_songs")
	})

	it("seeds only album-art rows and is idempotent", async () => {
		await pool.query(
			`INSERT INTO requested_songs (video_id, song, artist, thumbnail_url, first_requested_at, last_requested_at)
			 VALUES ('good0000001','S','A','https://yt3.googleusercontent.com/a=w120-h120-l90-rj',0,0),
			        ('bad00000001','S','A','https://i.ytimg.com/vi/bad00000001/hq720.jpg',0,0)`
		)

		const first = await backfillArtwork(env)
		expect(first.seeded).toBe(1)
		expect((await getVideoArtwork(env, "good0000001"))?.artworkUrl).toBe(
			"https://yt3.googleusercontent.com/a=w544-h544-l90-rj"
		)
		expect(await getVideoArtwork(env, "bad00000001")).toBeNull()

		const second = await backfillArtwork(env)
		expect(second.seeded).toBe(0)
	})

	describe("edge cases", () => {
		it("seeds nothing from an empty table", async () => {
			expect((await backfillArtwork(env)).seeded).toBe(0)
		})

		it("does not overwrite artwork seeded from a later request", async () => {
			await pool.query(
				`INSERT INTO requested_songs (video_id, song, artist, thumbnail_url, first_requested_at, last_requested_at)
				 VALUES ('keep0000001','S','A','https://yt3.googleusercontent.com/old=w544-h544',0,0)`
			)
			await pool.query(
				"INSERT INTO song_artwork (video_id, artwork_url, checked_at) VALUES ('keep0000001','https://yt3.googleusercontent.com/new=w544-h544',1)"
			)
			const result = await backfillArtwork(env)
			expect(result.seeded).toBe(0)
			expect((await getVideoArtwork(env, "keep0000001"))?.artworkUrl).toBe(
				"https://yt3.googleusercontent.com/new=w544-h544"
			)
		})
	})
})
