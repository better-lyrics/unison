import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { D1Compat } from "@/infra/database"
import type { Env, LyricsSubmission } from "@/types"
import { findBySongArtist, searchBySongArtist, submitLyrics } from "./lyrics"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

function buildSubmission(over: Partial<LyricsSubmission> = {}): LyricsSubmission {
	return {
		videoId: "V1",
		song: "Angin Malam",
		artist: "Prominent Band",
		duration: 200,
		lyrics: "hello world\nsecond line\nthird line",
		format: "plain",
		syncType: "plain",
		language: "id",
		...over,
	}
}

describeIntegration("findBySongArtist / searchBySongArtist album + duration matching (integration)", () => {
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

	async function wipe() {
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics_video_ids")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function seedUser(keyId: string): Promise<number> {
		const row = (
			await pool.query("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [keyId])
		).rows[0] as { id: number }
		return row.id
	}

	beforeEach(wipe)

	describe("album is a soft preference, never a hard filter", () => {
		it("regression: a null-album row resolves when a consumer passes an album", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", album: undefined }), u)

			const found = await findBySongArtist(
				env,
				"Angin Malam",
				"Prominent Band",
				undefined,
				"All or Nothing"
			)

			expect(found).not.toBeNull()
			expect(found?.video_id).toBe("V1")
		})

		it("regression: a mismatched album string still resolves", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(
				env,
				buildSubmission({ videoId: "V1", album: "All or Nothing (Deluxe)" }),
				u
			)

			const found = await findBySongArtist(
				env,
				"Angin Malam",
				"Prominent Band",
				undefined,
				"All or Nothing"
			)

			expect(found?.video_id).toBe("V1")
		})

		it("selects the album-matching variant when several variants exist", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "VX", album: "Album X" }), u)
			await submitLyrics(env, buildSubmission({ videoId: "VY", album: "Album Y" }), u)

			const found = await findBySongArtist(
				env,
				"Angin Malam",
				"Prominent Band",
				undefined,
				"Album Y"
			)

			expect(found?.album).toBe("Album Y")
		})

		it("searchBySongArtist keeps non-matching-album rows and ranks the album match first", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "VN", album: undefined }), u)
			await submitLyrics(env, buildSubmission({ videoId: "VM", album: "Album Y" }), u)

			const rows = await searchBySongArtist(
				env,
				"Angin Malam",
				"Prominent Band",
				undefined,
				"Album Y"
			)

			expect(rows.length).toBe(2)
			expect(rows[0].album).toBe("Album Y")
		})
	})

	describe("duration stays a hard window (column is NOT NULL, so every row has one)", () => {
		it("matches a row within the ±2s tolerance", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", duration: 200 }), u)

			const found = await findBySongArtist(env, "Angin Malam", "Prominent Band", 201)

			expect(found?.video_id).toBe("V1")
		})

		it("excludes a row outside the duration window", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", duration: 200 }), u)

			const found = await findBySongArtist(env, "Angin Malam", "Prominent Band", 999)

			expect(found).toBeNull()
		})
	})
})
