import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { D1Compat } from "@/infra/database"
import type { Env, LyricsSubmission } from "@/types"
import { awardFirstForSongXp, getXp } from "./contribution-events"
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

describeIntegration("submitLyrics first-for-song xp (integration)", () => {
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

	const eventsForLyric = async (lyricsId: number): Promise<number> =>
		num(
			"SELECT count(*)::int n FROM contribution_events WHERE kind = 'first-for-song' AND ref_type = 'lyric' AND ref_id = $1",
			[lyricsId]
		)

	beforeEach(wipe)

	it("awards first-for-song to the submitter of the first lyric for a video", async () => {
		const a = await seedUser("key-a")

		const result = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)

		expect(result.created).toBe(true)
		expect(await firstForSongCount(a)).toBe(1)

		const event = await one<{ delta: number; ref_type: string; ref_id: number }>(
			"SELECT delta, ref_type, ref_id FROM contribution_events WHERE user_id = $1 AND kind = 'first-for-song'",
			[a]
		)
		expect(event.delta).toBe(10)
		expect(event.ref_type).toBe("lyric")
		expect(Number(event.ref_id)).toBe(result.id)
		expect(await getXp(env, a)).toBe(10)
	})

	it("does not award first-for-song to a second lyric on the same video", async () => {
		const a = await seedUser("key-a")
		const b = await seedUser("key-b")

		const first = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)
		const second = await submitLyrics(env, buildSubmission({ videoId: "V1" }), b)

		expect(first.created).toBe(true)
		expect(second.created).toBe(true)
		expect(await eventsForLyric(second.id)).toBe(0)
		expect(await firstForSongCount(b)).toBe(0)
		expect(await getXp(env, b)).toBe(0)
	})

	it("awards first-for-song independently for a different video", async () => {
		const a = await seedUser("key-a")

		const v1 = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)
		const v2 = await submitLyrics(env, buildSubmission({ videoId: "V2" }), a)

		expect(await eventsForLyric(v1.id)).toBe(1)
		expect(await eventsForLyric(v2.id)).toBe(1)
		expect(await firstForSongCount(a)).toBe(2)
		expect(await getXp(env, a)).toBe(20)
	})

	describe("invariants", () => {
		it("is idempotent: re-awarding the same lyric does not double count", async () => {
			const a = await seedUser("key-a")
			const first = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)

			const again = await awardFirstForSongXp(env, a, first.id)

			expect(again).toBe(false)
			expect(await firstForSongCount(a)).toBe(1)
			expect(await getXp(env, a)).toBe(10)
		})

		it("keeps the earned first-for-song event after the submitter's lyric is soft-deleted", async () => {
			const a = await seedUser("key-a")
			const first = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)

			expect(await firstForSongCount(a)).toBe(1)
			expect(await getXp(env, a)).toBe(10)

			await pool.query(
				`UPDATE lyrics SET deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
					deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2`,
				[a, first.id]
			)

			expect(await eventsForLyric(first.id)).toBe(1)
			expect(await firstForSongCount(a)).toBe(1)
			expect(await getXp(env, a)).toBe(10)
		})
	})

	describe("edge cases", () => {
		it("treats a submission as first when the only prior lyric is soft-deleted", async () => {
			const a = await seedUser("key-a")
			const b = await seedUser("key-b")

			const first = await submitLyrics(env, buildSubmission({ videoId: "V1" }), a)
			await pool.query(
				`UPDATE lyrics SET deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
					deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2`,
				[a, first.id]
			)

			const second = await submitLyrics(env, buildSubmission({ videoId: "V1" }), b)

			expect(second.created).toBe(true)
			expect(await eventsForLyric(second.id)).toBe(1)
			expect(await firstForSongCount(b)).toBe(1)
			expect(await getXp(env, b)).toBe(10)
		})

		it("does not treat a submission as first when a penalized but undeleted prior lyric exists", async () => {
			const a = await seedUser("key-a")
			const b = await seedUser("key-b")

			await pool.query(
				`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, reputation_penalized)
				 VALUES ($1, 'Song', 'Artist', 200, 'song', 'artist', 'gz', 'plain', 'plain', $2, TRUE)`,
				["V1", a]
			)

			const second = await submitLyrics(env, buildSubmission({ videoId: "V1" }), b)

			expect(second.created).toBe(true)
			expect(await eventsForLyric(second.id)).toBe(0)
			expect(await firstForSongCount(b)).toBe(0)
			expect(await getXp(env, b)).toBe(0)
		})
	})
})
