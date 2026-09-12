import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getVideoArtwork } from "@/db/artwork"
import { createRequest } from "@/db/requests"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("createRequest artwork seed (integration)", () => {
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
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM song_artwork")
		await pool.query("DELETE FROM requested_songs")
	})

	it("seeds song_artwork when the request thumbnail is real album art", async () => {
		await createRequest(env, {
			videoId: "artreq00001",
			song: "S",
			artist: "A",
			thumbnailUrl: "https://yt3.googleusercontent.com/a=w120-h120-l90-rj",
			requesterId: "r1",
			requesterType: "extension",
			weight: 1,
		})
		expect((await getVideoArtwork(env, "artreq00001"))?.artworkUrl).toBe(
			"https://yt3.googleusercontent.com/a=w544-h544-l90-rj"
		)
	})

	describe("edge cases", () => {
		it("does not seed song_artwork for a ytimg thumbnail", async () => {
			await createRequest(env, {
				videoId: "vidreq00002",
				song: "S",
				artist: "A",
				thumbnailUrl: "https://i.ytimg.com/vi/vidreq00002/hq720.jpg",
				requesterId: "r1",
				requesterType: "extension",
				weight: 1,
			})
			expect(await getVideoArtwork(env, "vidreq00002")).toBeNull()
		})

		it("does not seed song_artwork for a null thumbnail", async () => {
			await createRequest(env, {
				videoId: "vidreq00003",
				song: "S",
				artist: "A",
				thumbnailUrl: null,
				requesterId: "r1",
				requesterType: "extension",
				weight: 1,
			})
			expect(await getVideoArtwork(env, "vidreq00003")).toBeNull()
		})

		it("does not overwrite existing artwork on a repeat request", async () => {
			await createRequest(env, {
				videoId: "vidreq00004",
				song: "S",
				artist: "A",
				thumbnailUrl: "https://yt3.googleusercontent.com/first=w544-h544",
				requesterId: "r1",
				requesterType: "extension",
				weight: 1,
			})
			await createRequest(env, {
				videoId: "vidreq00004",
				song: "S",
				artist: "A",
				thumbnailUrl: "https://yt3.googleusercontent.com/second=w544-h544",
				requesterId: "r2",
				requesterType: "extension",
				weight: 1,
			})
			expect((await getVideoArtwork(env, "vidreq00004"))?.artworkUrl).toBe(
				"https://yt3.googleusercontent.com/first=w544-h544"
			)
		})
	})
})
