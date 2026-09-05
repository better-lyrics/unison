import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID } from "@/config"
import { D1Compat } from "@/infra/database"
import { backfillBadges } from "@/jobs/backfill-badges"
import { backfillXp } from "@/jobs/backfill-xp"
import type { Confidence, Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("backfill badges (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let userSeq = 0
	let videoSeq = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T
	const num = async (sql: string, params: unknown[] = []): Promise<number> =>
		Number((await pool.query(sql, params)).rows[0].n)

	const awardsFor = (userId: number): Promise<{ badge_key: string; tier: number | null }[]> =>
		pool
			.query("SELECT badge_key, tier FROM badge_awards WHERE user_id = $1 ORDER BY badge_key", [
				userId,
			])
			.then((r) => r.rows)

	async function seedUser(keyId?: string): Promise<number> {
		userSeq++
		const key = keyId ?? userSeq.toString(16).padStart(64, "0")
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			key,
		])
		return row.id
	}

	async function insertLyric(submitterId: number, confidence: Confidence): Promise<number> {
		videoSeq++
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, confidence)
			 VALUES ($1,'Song','Artist',180,'song','artist','gz','lrc','linesync',$2,$3) RETURNING id`,
			[`vid${videoSeq}`, submitterId, confidence]
		)
		return row.id
	}

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
		await pool.query("DELETE FROM migration_requests")
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM discord_links")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	beforeEach(wipe)

	describe("happy", () => {
		it("awards medals to a dormant contributor from the real xp-then-badge chain", async () => {
			const userId = await seedUser()
			for (let i = 0; i < 5; i++) await insertLyric(userId, "medium")

			await backfillXp(env)
			const result = await backfillBadges(env)

			expect(result.evaluated).toBe(1)
			expect(result.awarded).toBe(1)

			const rows = await awardsFor(userId)
			const byKey = new Map(rows.map((r) => [r.badge_key, r.tier]))
			expect(byKey.get("verified-contributor")).toBe(2)
			expect(byKey.get("trailblazer")).toBe(1)
			expect(byKey.has("first-submission")).toBe(true)
		})
	})

	describe("community", () => {
		it("awards the community badge to the aggregate key with zero events, and only that", async () => {
			const communityId = await seedUser(COMMUNITY_KEY_ID)

			const result = await backfillBadges(env)

			expect(result.evaluated).toBe(1)
			expect(result.awarded).toBe(1)

			const rows = await awardsFor(communityId)
			expect(rows.map((r) => r.badge_key)).toEqual(["community"])
		})
	})

	describe("empty", () => {
		it("awards nothing to a user with no events who is not blacklisted", async () => {
			const userId = await seedUser()

			const result = await backfillBadges(env)

			expect(result).toEqual({ evaluated: 0, awarded: 0 })
			expect(await awardsFor(userId)).toEqual([])
			expect(await num("SELECT count(*)::int n FROM badge_awards")).toBe(0)
		})
	})

	describe("invariants", () => {
		it("is idempotent: a second pass yields identical rows and tiers", async () => {
			const userId = await seedUser()
			for (let i = 0; i < 5; i++) await insertLyric(userId, "medium")
			const communityId = await seedUser(COMMUNITY_KEY_ID)

			await backfillXp(env)

			const first = await backfillBadges(env)
			const rowsAfterFirst = await awardsFor(userId)
			const communityAfterFirst = await awardsFor(communityId)

			expect(first).toEqual({ evaluated: 2, awarded: 2 })

			const second = await backfillBadges(env)
			const rowsAfterSecond = await awardsFor(userId)
			const communityAfterSecond = await awardsFor(communityId)

			expect(second.evaluated).toBe(first.evaluated)
			expect(second.awarded).toBe(0)
			expect(rowsAfterSecond).toEqual(rowsAfterFirst)
			expect(communityAfterSecond).toEqual(communityAfterFirst)
			expect(await num("SELECT count(*)::int n FROM badge_awards")).toBe(
				rowsAfterFirst.length + communityAfterFirst.length
			)
		})
	})
})
