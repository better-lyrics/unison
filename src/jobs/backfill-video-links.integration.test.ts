import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { backfillVideoLinks } from "./backfill-video-links"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("backfillVideoLinks (integration)", () => {
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
		await pool.query("DELETE FROM lyrics_video_ids")
		await pool.query("DELETE FROM lyrics")
	})

	async function seedLyric(videoId: string): Promise<number> {
		const res = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type)
			 VALUES ($1, 'Song', 'Artist', 200, 'song', 'artist', 'x', 'plain', 'plain') RETURNING id`,
			[videoId]
		)
		return res.rows[0].id
	}

	const linksFor = async (lyricsId: number): Promise<string[]> =>
		(
			await pool.query(
				"SELECT video_id FROM lyrics_video_ids WHERE lyrics_id = $1 ORDER BY video_id",
				[lyricsId]
			)
		).rows.map((r) => r.video_id as string)

	it("links every existing row to its own primary", async () => {
		const a = await seedLyric("dQw4w9WgXcQ")
		const b = await seedLyric("9bZkp7q19f0")
		const { linked } = await backfillVideoLinks(env)
		expect(linked).toBe(2)
		expect(await linksFor(a)).toEqual(["dQw4w9WgXcQ"])
		expect(await linksFor(b)).toEqual(["9bZkp7q19f0"])
	})

	describe("regressions", () => {
		it("regression: idempotent, no duplicates and reports zero on a second run", async () => {
			const a = await seedLyric("dQw4w9WgXcQ")
			await backfillVideoLinks(env)
			const second = await backfillVideoLinks(env)
			expect(second.linked).toBe(0)
			expect(await linksFor(a)).toEqual(["dQw4w9WgXcQ"])
		})
	})

	describe("edge cases", () => {
		it("edge: leaves an existing extra link intact and only adds the missing primary", async () => {
			const a = await seedLyric("dQw4w9WgXcQ")
			await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
				a,
				"9bZkp7q19f0",
			])
			const { linked } = await backfillVideoLinks(env)
			expect(linked).toBe(1)
			expect(await linksFor(a)).toEqual(["9bZkp7q19f0", "dQw4w9WgXcQ"])
		})

		it("edge: no rows to backfill reports zero", async () => {
			const { linked } = await backfillVideoLinks(env)
			expect(linked).toBe(0)
		})
	})
})
