import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { addEvent, awardConfidenceXp, awardFirstForSongXp, getXp } from "./contribution-events"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("contribution events (integration)", () => {
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

	async function insertLyric(submitterId: number, videoId: string): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1,'Song','Artist',180,'song','artist','gz','plain','plain',$2) RETURNING id`,
			[videoId, submitterId]
		)
		return row.id
	}

	beforeEach(wipe)

	it("inserts one row and returns true on first call", async () => {
		const userId = await seedUser("key-happy")

		const inserted = await addEvent(env, {
			userId,
			delta: 20,
			kind: "submission_accepted",
			refType: "lyrics",
			refId: 1,
		})

		expect(inserted).toBe(true)
		expect(
			await num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1", [userId])
		).toBe(1)
		expect(await getXp(env, userId)).toBe(20)
	})

	it("is idempotent for a repeated (userId, kind, refType, refId)", async () => {
		const userId = await seedUser("key-idem")
		const event = {
			userId,
			delta: 20,
			kind: "submission_accepted",
			refType: "lyrics",
			refId: 1,
		}

		expect(await addEvent(env, event)).toBe(true)
		expect(await addEvent(env, event)).toBe(false)

		expect(
			await num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1", [userId])
		).toBe(1)
		expect(await getXp(env, userId)).toBe(20)
	})

	it("sums multiple events including a negative delta", async () => {
		const userId = await seedUser("key-sum")

		await addEvent(env, {
			userId,
			delta: 20,
			kind: "submission_accepted",
			refType: "lyrics",
			refId: 1,
		})
		await addEvent(env, {
			userId,
			delta: -30,
			kind: "submission_removed",
			refType: "lyrics",
			refId: 2,
		})

		expect(await getXp(env, userId)).toBe(-10)
	})

	describe("edge cases", () => {
		it("getXp returns 0 for a user with no events", async () => {
			const userId = await seedUser("key-empty")
			expect(await getXp(env, userId)).toBe(0)
		})
	})

	describe("invariants", () => {
		it("events differing only in refId are both stored and both counted", async () => {
			const userId = await seedUser("key-refid")

			expect(
				await addEvent(env, { userId, delta: 5, kind: "vote_cast", refType: "lyrics", refId: 1 })
			).toBe(true)
			expect(
				await addEvent(env, { userId, delta: 5, kind: "vote_cast", refType: "lyrics", refId: 2 })
			).toBe(true)

			expect(
				await num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1", [userId])
			).toBe(2)
			expect(await getXp(env, userId)).toBe(10)
		})

		it("events differing only in kind are both stored and both counted", async () => {
			const userId = await seedUser("key-kind")

			expect(
				await addEvent(env, {
					userId,
					delta: 20,
					kind: "submission_accepted",
					refType: "lyrics",
					refId: 1,
				})
			).toBe(true)
			expect(
				await addEvent(env, {
					userId,
					delta: 5,
					kind: "vote_cast",
					refType: "lyrics",
					refId: 1,
				})
			).toBe(true)

			expect(
				await num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1", [userId])
			).toBe(2)
			expect(await getXp(env, userId)).toBe(25)
		})

		it("getXp is scoped per user and never leaks another user's events", async () => {
			const userA = await seedUser("key-scope-a")
			const userB = await seedUser("key-scope-b")

			await addEvent(env, {
				userId: userA,
				delta: 20,
				kind: "submission_accepted",
				refType: "lyrics",
				refId: 1,
			})
			await addEvent(env, {
				userId: userB,
				delta: 7,
				kind: "vote_cast",
				refType: "lyrics",
				refId: 2,
			})

			expect(await getXp(env, userA)).toBe(20)
			expect(await getXp(env, userB)).toBe(7)
		})
	})

	describe("awardConfidenceXp", () => {
		const kindCount = async (userId: number, kind: string): Promise<number> =>
			num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1 AND kind = $2", [
				userId,
				kind,
			])

		it("emits nothing for low confidence", async () => {
			const userId = await seedUser("key-conf-low")

			await awardConfidenceXp(env, userId, 1, "low")

			expect(
				await num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1", [userId])
			).toBe(0)
			expect(await getXp(env, userId)).toBe(0)
		})

		it("emits exactly one reached-medium for medium confidence and is idempotent", async () => {
			const userId = await seedUser("key-conf-medium")

			await awardConfidenceXp(env, userId, 1, "medium")

			expect(await kindCount(userId, "reached-medium")).toBe(1)
			expect(await kindCount(userId, "reached-high")).toBe(0)
			expect(await getXp(env, userId)).toBe(20)

			await awardConfidenceXp(env, userId, 1, "medium")

			expect(await kindCount(userId, "reached-medium")).toBe(1)
			expect(await getXp(env, userId)).toBe(20)
		})

		it("emits both reached-medium and reached-high for high confidence and is idempotent", async () => {
			const userId = await seedUser("key-conf-high")

			await awardConfidenceXp(env, userId, 1, "high")

			expect(await kindCount(userId, "reached-medium")).toBe(1)
			expect(await kindCount(userId, "reached-high")).toBe(1)
			expect(await getXp(env, userId)).toBe(40)

			await awardConfidenceXp(env, userId, 1, "high")

			expect(await kindCount(userId, "reached-medium")).toBe(1)
			expect(await kindCount(userId, "reached-high")).toBe(1)
			expect(await getXp(env, userId)).toBe(40)
		})
	})

	describe("awardFirstForSongXp", () => {
		const FIRST = config.gamification.xp.weights.firstForSong

		it("emits nothing for a low-confidence lyric", async () => {
			const userId = await seedUser("ffs-low")
			const lyricId = await insertLyric(userId, "vidLow")

			expect(await awardFirstForSongXp(env, userId, lyricId, "vidLow", "low")).toBe(false)
			expect(await getXp(env, userId)).toBe(0)
		})

		it("emits nothing when the lyric is not the earliest for its video", async () => {
			const early = await seedUser("ffs-early")
			const late = await seedUser("ffs-late")
			await insertLyric(early, "vidMulti")
			const later = await insertLyric(late, "vidMulti")

			expect(await awardFirstForSongXp(env, late, later, "vidMulti", "medium")).toBe(false)
			expect(await getXp(env, late)).toBe(0)
		})

		it("awards the earliest lyric once it reaches medium confidence", async () => {
			const userId = await seedUser("ffs-medium")
			const lyricId = await insertLyric(userId, "vidMed")

			expect(await awardFirstForSongXp(env, userId, lyricId, "vidMed", "medium")).toBe(true)
			expect(await getXp(env, userId)).toBe(FIRST)
		})

		it("awards on high confidence as well", async () => {
			const userId = await seedUser("ffs-high")
			const lyricId = await insertLyric(userId, "vidHigh")

			expect(await awardFirstForSongXp(env, userId, lyricId, "vidHigh", "high")).toBe(true)
			expect(await getXp(env, userId)).toBe(FIRST)
		})

		it("is idempotent for a repeated award", async () => {
			const userId = await seedUser("ffs-idem")
			const lyricId = await insertLyric(userId, "vidIdem")

			expect(await awardFirstForSongXp(env, userId, lyricId, "vidIdem", "medium")).toBe(true)
			expect(await awardFirstForSongXp(env, userId, lyricId, "vidIdem", "medium")).toBe(false)
			expect(await getXp(env, userId)).toBe(FIRST)
		})
	})
})
