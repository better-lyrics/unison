import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { awardRequestFilledXp, getXp } from "./contribution-events"
import { recordFulfillment } from "./fulfillments"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const FILLER_KEY = "filler-key"
const REQUESTER_KEY = "requester-key"
const VIDEO_ID = "vidFill"

describeIntegration("recordFulfillment xp (integration)", () => {
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
		env = { DB: new D1Compat(pool) } as unknown as Env
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

	async function seedLyric(submitterId: number, videoId: string): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2) RETURNING id`,
			[videoId, submitterId]
		)
		return row.id
	}

	async function seedDemand(videoId: string, requesterKey: string): Promise<void> {
		await pool.query("INSERT INTO requested_songs (video_id, song, artist) VALUES ($1, 's', 'a')", [
			videoId,
		])
		await pool.query(
			"INSERT INTO lyrics_requests (video_id, requester_id, requester_type) VALUES ($1, $2, 'extension')",
			[videoId, requesterKey]
		)
	}

	const requestFilledCount = async (userId: number): Promise<number> =>
		num(
			"SELECT count(*)::int n FROM contribution_events WHERE user_id = $1 AND kind = 'request-filled'",
			[userId]
		)

	beforeEach(wipe)

	it("awards one request-filled event to the filler on a recorded fulfillment", async () => {
		const submitterId = await seedUser(FILLER_KEY)
		const lyricsId = await seedLyric(submitterId, VIDEO_ID)
		await seedDemand(VIDEO_ID, REQUESTER_KEY)

		const result = await recordFulfillment(env, {
			videoId: VIDEO_ID,
			lyricsId,
			submitterId,
			submitterKeyId: FILLER_KEY,
		})

		expect(result.recorded).toBe(true)
		if (!result.recorded) throw new Error("expected recorded fulfillment")

		expect(await requestFilledCount(submitterId)).toBe(1)
		const event = await one<{ delta: number; ref_type: string; ref_id: number }>(
			"SELECT delta, ref_type, ref_id FROM contribution_events WHERE user_id = $1 AND kind = 'request-filled'",
			[submitterId]
		)
		expect(event.delta).toBe(15)
		expect(event.ref_type).toBe("fulfillment")
		expect(Number(event.ref_id)).toBe(Number(result.id))
		expect(await getXp(env, submitterId)).toBe(15)
	})

	it("is idempotent when the helper is called again for the same fulfillment", async () => {
		const submitterId = await seedUser(FILLER_KEY)
		const lyricsId = await seedLyric(submitterId, VIDEO_ID)
		await seedDemand(VIDEO_ID, REQUESTER_KEY)

		const result = await recordFulfillment(env, {
			videoId: VIDEO_ID,
			lyricsId,
			submitterId,
			submitterKeyId: FILLER_KEY,
		})
		if (!result.recorded) throw new Error("expected recorded fulfillment")

		await awardRequestFilledXp(env, submitterId, result.id)

		expect(await requestFilledCount(submitterId)).toBe(1)
		expect(await getXp(env, submitterId)).toBe(15)
	})

	describe("edge cases", () => {
		it("emits no request-filled event when there is no live demand", async () => {
			const submitterId = await seedUser(FILLER_KEY)
			const lyricsId = await seedLyric(submitterId, VIDEO_ID)

			const result = await recordFulfillment(env, {
				videoId: VIDEO_ID,
				lyricsId,
				submitterId,
				submitterKeyId: FILLER_KEY,
			})

			expect(result.recorded).toBe(false)
			if (result.recorded) throw new Error("expected an unrecorded fulfillment")
			expect(result.reason).toBe("no_live_demand")
			expect(await requestFilledCount(submitterId)).toBe(0)
			expect(await getXp(env, submitterId)).toBe(0)
		})
	})
})
