import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { D1Compat } from "@/infra/database"
import type { Env, LyricsSubmission } from "@/types"
import { getXp } from "./contribution-events"
import { submitLyrics } from "./lyrics"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

function buildSubmission(over: Partial<LyricsSubmission> = {}): LyricsSubmission {
	return {
		videoId: "V1",
		song: "Song",
		artist: "Artist",
		duration: 200,
		lyrics: "hello world\nsecond line\nthird line",
		format: "plain",
		syncType: "plain",
		language: "en",
		...over,
	}
}

describeIntegration("submitLyrics does not award first-for-song xp on raw submit (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T
	const num = async (sql: string, params: unknown[] = []): Promise<number> =>
		Number((await pool.query(sql, params)).rows[0].n)

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
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM badge_awards")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM contribution_events")
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function seedUser(keyId: string): Promise<number> {
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	const firstForSongCount = async (userId: number): Promise<number> =>
		num(
			"SELECT count(*)::int n FROM contribution_events WHERE user_id = $1 AND kind = 'first-for-song'",
			[userId]
		)

	beforeEach(wipe)

	it("regression: raw submit of the first lyric for a video credits no first-for-song xp", async () => {
		const a = await seedUser("key-a")

		const result = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)

		expect(result.created).toBe(true)
		expect(await firstForSongCount(a)).toBe(0)
		expect(await getXp(env, a)).toBe(0)
	})

	it("regression: submitting many novel videos credits no xp (no farming vector)", async () => {
		const a = await seedUser("key-a")

		await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)
		await submitLyrics(env, buildSubmission({ videoId: "V2" }), a)
		await submitLyrics(env, buildSubmission({ videoId: "V3" }), a)

		expect(await firstForSongCount(a)).toBe(0)
		expect(await getXp(env, a)).toBe(0)
	})

	it("stores has_translation = true when a submitted TTML carries a translation marker", async () => {
		const a = await seedUser("key-t")
		const ttml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="ja">
  <body><div><p><span>原文</span><span ttm:role="x-translation">source</span></p></div></body>
</tt>`
		const result = await submitLyrics(
			env,
			buildSubmission({ videoId: "VT", format: "ttml", lyrics: ttml }),
			a
		)

		const row = await one<{ has_translation: boolean | null }>(
			"SELECT has_translation FROM lyrics WHERE id = $1",
			[result.id]
		)
		expect(row.has_translation).toBe(true)
	})

	it("stores has_translation = false for a plain submission", async () => {
		const a = await seedUser("key-p")
		const result = await submitLyrics(env, buildSubmission({ videoId: "VP" }), a)

		const row = await one<{ has_translation: boolean | null }>(
			"SELECT has_translation FROM lyrics WHERE id = $1",
			[result.id]
		)
		expect(row.has_translation).toBe(false)
	})
})
