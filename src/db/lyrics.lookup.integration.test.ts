import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import { wipeCouncilTables } from "@/test/integration-harness"
import type { Env, LyricsSubmission } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { findByIsrc, findBySongArtist, searchBySongArtist, submitLyrics } from "./lyrics"

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
		await wipeCouncilTables(pool)
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

	describe("artist credit matching", () => {
		const madvillain = {
			song: "Shadows of Tomorrow (feat. Quasimoto)",
			artist: "Madvillain, Madlib, MF Doom",
		}

		it("regression: resolves when the consumer sends part of a multi-artist credit", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "MV", ...madvillain }), u)

			for (const artist of [
				"Madvillain Madlib",
				"Madvillain",
				"MF DOOM",
				"Madlib & Madvillain",
			]) {
				const found = await findBySongArtist(env, madvillain.song, artist)
				expect(found?.video_id, artist).toBe("MV")
			}
		})

		it("resolves when the consumer credits more artists than the submitter", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", artist: "Madvillain" }), u)

			const found = await findBySongArtist(env, "Angin Malam", "Madvillain, Madlib")

			expect(found?.video_id).toBe("V1")
		})

		it("treats & and the word and alike", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", artist: "Simon & Garfunkel" }), u)

			for (const artist of ["Simon and Garfunkel", "Simon, Garfunkel", "Simon Garfunkel"]) {
				expect((await findBySongArtist(env, "Angin Malam", artist))?.video_id, artist).toBe("V1")
			}
		})

		it("prefers the variant whose credit matches exactly", async () => {
			const u = await seedUser("key-a")
			const partial = await submitLyrics(
				env,
				buildSubmission({ videoId: "VP", artist: "Drake, Future" }),
				u
			)
			await submitLyrics(env, buildSubmission({ videoId: "VE", artist: "Drake" }), u)
			await pool.query("UPDATE lyrics SET effective_score = 5, vote_count = 50 WHERE id = $1", [
				partial.id,
			])

			expect((await findBySongArtist(env, "Angin Malam", "Drake"))?.video_id).toBe("VE")
		})

		it("searchBySongArtist lists every variant that shares a credited artist", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "VA", artist: "Drake" }), u)
			await submitLyrics(env, buildSubmission({ videoId: "VB", artist: "Drake, Future" }), u)
			await submitLyrics(env, buildSubmission({ videoId: "VC", artist: "Future" }), u)

			const rows = await searchBySongArtist(env, "Angin Malam", "Drake")

			expect(rows.map((r) => r.video_id).sort()).toEqual(["VA", "VB"])
		})

		describe("negatives", () => {
			it("does not match a different artist with the same title", async () => {
				const u = await seedUser("key-a")
				await submitLyrics(
					env,
					buildSubmission({ videoId: "V1", song: "Intro", artist: "The xx" }),
					u
				)

				expect(await findBySongArtist(env, "Intro", "alt-J")).toBeNull()
			})

			it("regression: one word of a credited name is not that artist", async () => {
				const u = await seedUser("key-a")
				for (const [videoId, artist] of [
					["V1", "Future Islands"],
					["V2", "Nick Drake"],
				]) {
					await submitLyrics(env, buildSubmission({ videoId, song: "Intro", artist }), u)
				}

				expect(await findBySongArtist(env, "Intro", "Future")).toBeNull()
				expect(await findBySongArtist(env, "Intro", "Drake")).toBeNull()
				expect(await searchBySongArtist(env, "Intro", "Future")).toEqual([])
			})

			it("does not match part of a word", async () => {
				const u = await seedUser("key-a")
				await submitLyrics(env, buildSubmission({ videoId: "V1", artist: "Lady Gaga" }), u)

				expect(await findBySongArtist(env, "Angin Malam", "Ga")).toBeNull()
				expect(await findBySongArtist(env, "Angin Malam", "Lady Gagaa")).toBeNull()
			})

			it("does not match a blank artist", async () => {
				const u = await seedUser("key-a")
				await submitLyrics(env, buildSubmission({ videoId: "V1" }), u)

				expect(await findBySongArtist(env, "Angin Malam", " & ")).toBeNull()
			})
		})
	})

	describe("isrc", () => {
		it("stores a submitted ISRC in canonical form", async () => {
			const u = await seedUser("key-a")
			const { id } = await submitLyrics(env, buildSubmission({ isrc: "us-2s7-04-65012" }), u)

			const { rows } = await pool.query("SELECT isrc FROM lyrics WHERE id = $1", [id])

			expect(rows[0].isrc).toBe("US2S70465012")
		})

		it("regression: stores no ISRC for a value that is not one, and never matches it", async () => {
			const u = await seedUser("key-a")
			const { id } = await submitLyrics(env, buildSubmission({ isrc: "love" }), u)

			const { rows } = await pool.query("SELECT isrc FROM lyrics WHERE id = $1", [id])

			expect(rows[0].isrc).toBeNull()
			expect(await findByIsrc(env, "love")).toBeNull()
			expect(await findByIsrc(env, "LOVE")).toBeNull()
		})

		it("finds a lyric by ISRC in any case or format", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "V1", isrc: "US2S70465012" }), u)

			for (const isrc of ["US2S70465012", "us2s70465012", "US-2S7-04-65012"]) {
				expect((await findByIsrc(env, isrc))?.video_id, isrc).toBe("V1")
			}
		})

		it("returns the top-ranked variant for a shared ISRC", async () => {
			const u = await seedUser("key-a")
			await submitLyrics(env, buildSubmission({ videoId: "VL", isrc: "US2S70465012" }), u)
			const top = await submitLyrics(
				env,
				buildSubmission({ videoId: "VT", isrc: "US2S70465012" }),
				u
			)
			await pool.query("UPDATE lyrics SET effective_score = 3, vote_count = 10 WHERE id = $1", [
				top.id,
			])

			expect((await findByIsrc(env, "US2S70465012"))?.video_id).toBe("VT")
		})

		describe("schema", () => {
			it("rewrites legacy ISRCs into canonical form, clears junk, and stays idempotent", async () => {
				const u = await seedUser("key-a")
				const legacy = await submitLyrics(env, buildSubmission({ videoId: "V1" }), u)
				const junk = await submitLyrics(env, buildSubmission({ videoId: "V2" }), u)
				await pool.query("UPDATE lyrics SET isrc = 'us-2s7-04-65012' WHERE id = $1", [legacy.id])
				await pool.query("UPDATE lyrics SET isrc = 'n/a' WHERE id = $1", [junk.id])
				const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")

				await pool.query(schema)
				await pool.query(schema)

				const { rows } = await pool.query("SELECT id, isrc FROM lyrics ORDER BY id")
				expect(rows.map((r) => r.isrc)).toEqual(["US2S70465012", null])
			})

			it("rewrites legacy revision ISRCs so they match the live lyric", async () => {
				const u = await seedUser("key-a")
				const { id } = await submitLyrics(env, buildSubmission({ isrc: "US2S70465012" }), u)
				await pool.query("UPDATE lyric_revisions SET isrc = 'us-2s7-04-65012' WHERE lyrics_id = $1", [
					id,
				])
				const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")

				await pool.query(schema)

				const { rows } = await pool.query("SELECT isrc FROM lyric_revisions WHERE lyrics_id = $1", [id])
				expect(rows[0].isrc).toBe("US2S70465012")
			})

			it("clears a revision ISRC that is not one", async () => {
				const u = await seedUser("key-a")
				const { id } = await submitLyrics(env, buildSubmission({ isrc: "US2S70465012" }), u)
				await pool.query(
					"UPDATE lyric_revisions SET isrc = 'Cause I can''t go back' WHERE lyrics_id = $1",
					[id]
				)
				const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")

				await pool.query(schema)

				const { rows } = await pool.query("SELECT isrc FROM lyric_revisions WHERE lyrics_id = $1", [id])
				expect(rows[0].isrc).toBeNull()
			})

			it("regression: migrates when a stored ISRC is longer than a btree row allows", async () => {
				const u = await seedUser("key-a")
				const { id } = await submitLyrics(env, buildSubmission(), u)
				await pool.query("DROP INDEX IF EXISTS idx_lyrics_isrc")
				await pool.query(
					`UPDATE lyrics SET isrc = (SELECT string_agg(md5(i::TEXT), '') FROM generate_series(1, 400) i)
					 WHERE id = $1`,
					[id]
				)
				const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")

				await expect(pool.query(schema)).resolves.toBeDefined()
			})

			it("indexes ISRC lookups", async () => {
				const { rows } = await pool.query(
					"SELECT indexdef FROM pg_indexes WHERE tablename = 'lyrics' AND indexdef LIKE '%(isrc)%'"
				)
				expect(rows).toHaveLength(1)
			})
		})

		describe("edge cases", () => {
			it("returns null for an unknown or blank ISRC", async () => {
				const u = await seedUser("key-a")
				await submitLyrics(env, buildSubmission({ isrc: "US2S70465012" }), u)

				expect(await findByIsrc(env, "GBAYE0800346")).toBeNull()
				expect(await findByIsrc(env, " - ")).toBeNull()
			})

			it("skips deleted lyrics", async () => {
				const u = await seedUser("key-a")
				const { id } = await submitLyrics(env, buildSubmission({ isrc: "US2S70465012" }), u)
				await pool.query(
					`UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2,
					deleted_by_role = 'submitter' WHERE id = $1`,
					[id, u]
				)

				expect(await findByIsrc(env, "US2S70465012")).toBeNull()
			})
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
