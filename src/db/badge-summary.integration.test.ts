import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getBadgeSummaries } from "./badge-summary"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("badge summaries (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let userSeq = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

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
		await pool.query("DELETE FROM discord_links")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function newUser(): Promise<number> {
		userSeq++
		const keyId = userSeq.toString(16).padStart(64, "0")
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	async function award(userId: number, badgeKey: string, tier: number | null): Promise<void> {
		await pool.query("INSERT INTO badge_awards (user_id, badge_key, tier) VALUES ($1, $2, $3)", [
			userId,
			badgeKey,
			tier,
		])
	}

	beforeEach(wipe)

	it("counts every award and lets category order dominate the topBadge", async () => {
		const userId = await newUser()
		await award(userId, "verified-contributor", 2) // output (idx 1)
		await award(userId, "trailblazer", 3) // coverage (idx 3), higher tier
		await award(userId, "sharp-ear", 3) // curation (idx 4), higher tier
		await award(userId, "most-loved", null) // acclaim (idx 5)
		await award(userId, "committee", null) // special (idx 7)
		await award(userId, "community", null) // special, excluded from topBadge

		const summaries = await getBadgeSummaries(env, [userId])
		const summary = summaries.get(userId)

		expect(summary?.badgeCount).toBe(6)
		expect(summary?.topBadge).toEqual({
			key: "verified-contributor",
			name: "Verified Contributor",
			tier: 2,
		})
	})

	it("breaks ties inside a category by award tier descending", async () => {
		const userId = await newUser()
		await award(userId, "trailblazer", 1) // coverage
		await award(userId, "first-responder", null) // coverage, tier 0
		await award(userId, "polyglot", 3) // coverage, highest tier

		const summary = (await getBadgeSummaries(env, [userId])).get(userId)

		expect(summary?.badgeCount).toBe(3)
		expect(summary?.topBadge).toEqual({ key: "polyglot", name: "Polyglot", tier: 3 })
	})

	it("breaks a same-tier, same-category tie by key ascending", async () => {
		const userId = await newUser()
		await award(userId, "trailblazer", 1) // coverage
		await award(userId, "first-responder", 1) // coverage, "first-responder" < "trailblazer"

		const summary = (await getBadgeSummaries(env, [userId])).get(userId)

		expect(summary?.badgeCount).toBe(2)
		expect(summary?.topBadge).toEqual({ key: "first-responder", name: "First Responder", tier: 1 })
	})

	it("excludes a tier-category award from topBadge but still counts it", async () => {
		const userId = await newUser()
		await award(userId, "lyricist", null) // tier category (idx 0), must be ignored
		await award(userId, "most-loved", null) // acclaim

		const summary = (await getBadgeSummaries(env, [userId])).get(userId)

		expect(summary?.badgeCount).toBe(2)
		expect(summary?.topBadge).toEqual({ key: "most-loved", name: "Most Loved", tier: undefined })
	})

	it("returns a null topBadge but a nonzero count for a community-only user", async () => {
		const userId = await newUser()
		await award(userId, "community", null)

		const summary = (await getBadgeSummaries(env, [userId])).get(userId)

		expect(summary?.badgeCount).toBe(1)
		expect(summary?.topBadge).toBeNull()
	})

	it("omits users with no awards from the map", async () => {
		const withAward = await newUser()
		const withoutAward = await newUser()
		await award(withAward, "most-loved", null)

		const summaries = await getBadgeSummaries(env, [withAward, withoutAward])

		expect(summaries.has(withAward)).toBe(true)
		expect(summaries.has(withoutAward)).toBe(false)
	})
})

describe("getBadgeSummaries empty input", () => {
	it("returns an empty map without issuing a query", async () => {
		let queries = 0
		const db = {
			prepare() {
				return {
					bind() {
						return this
					},
					async all() {
						queries++
						return { results: [] }
					},
				}
			},
		}
		const env = { DB: db } as unknown as Env

		const summaries = await getBadgeSummaries(env, [])

		expect(summaries.size).toBe(0)
		expect(queries).toBe(0)
	})
})
