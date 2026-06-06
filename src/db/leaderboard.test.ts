import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { getCuratorLeaderboard, getMostWantedPage, getSongLeaderboard } from "./leaderboard"

interface DBCall {
	sql: string
	params: unknown[]
}

function makeMockDB(queue: unknown[] = []) {
	const calls: DBCall[] = []
	const db = {
		calls,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							return (queue.shift() as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							return { results: (queue.shift() as T[]) ?? [] }
						},
						async run(): Promise<void> {
							calls.push({ sql, params: args })
							queue.shift()
						},
					}
				},
			}
		},
	}
	return db
}

function makeMockCache() {
	return {
		async get() {
			return null
		},
		async put() {},
		async delete() {},
		async keys() {
			return []
		},
		async setNX() {
			return true
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: makeMockCache() as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

describe("getSongLeaderboard", () => {
	it("returns ranked most-wanted and needs-fixing sections", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "v1",
					song: "S1",
					artist: "A1",
					thumbnail_url: "t1",
					demand: 9,
					request_count: 9,
				},
				{
					video_id: "v2",
					song: "S2",
					artist: "A2",
					thumbnail_url: null,
					demand: 4,
					request_count: 4,
				},
			],
			[
				{
					video_id: "v9",
					song: "S9",
					artist: "A9",
					thumbnail_url: null,
					demand: 7,
					report_count: 6,
				},
			],
		])
		const env = makeEnv(db)
		const result = await getSongLeaderboard(env, 200)
		expect(result.mostWanted[0]).toMatchObject({
			videoId: "v1",
			rank: 1,
			section: "most_wanted",
		})
		expect(result.mostWanted[1].rank).toBe(2)
		expect(result.needsFixing[0]).toMatchObject({
			videoId: "v9",
			rank: 1,
			section: "needs_fixing",
		})
	})
})

describe("getMostWantedPage", () => {
	it("returns the first page with a populated nextCursor when more rows could exist", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "v1",
					song: "S1",
					artist: "A1",
					thumbnail_url: null,
					demand: 9,
					request_count: 9,
				},
				{
					video_id: "v2",
					song: "S2",
					artist: "A2",
					thumbnail_url: null,
					demand: 4,
					request_count: 4,
				},
			],
		])
		const env = makeEnv(db)
		const { items, nextCursor } = await getMostWantedPage(env, null, 2)
		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({ videoId: "v1", rank: 1, section: "most_wanted" })
		expect(items[1].rank).toBe(2)
		expect(nextCursor).toMatchObject({ demand: 4, videoId: "v2", lastRank: 2 })
		expect(nextCursor?.cutoff).toEqual(expect.any(Number))
		expect(db.calls[0].sql).not.toContain("HAVING")
		expect(db.calls[0].params).toEqual([expect.any(Number), 2])
	})

	it("paginates using the supplied cursor and emits a HAVING clause", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "v3",
					song: "S3",
					artist: "A3",
					thumbnail_url: null,
					demand: 3,
					request_count: 3,
				},
				{
					video_id: "v4",
					song: "S4",
					artist: "A4",
					thumbnail_url: null,
					demand: 2,
					request_count: 2,
				},
			],
		])
		const env = makeEnv(db)
		const { items, nextCursor } = await getMostWantedPage(
			env,
			{ demand: 4, videoId: "v2", cutoff: 1_700_000_000, lastRank: 20 },
			2
		)
		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({ videoId: "v3", rank: 21 })
		expect(items[1].rank).toBe(22)
		expect(nextCursor).toEqual({ demand: 2, videoId: "v4", cutoff: 1_700_000_000, lastRank: 22 })
		expect(db.calls[0].sql).toContain("HAVING")
		expect(db.calls[0].params).toEqual([1_700_000_000, 4, 4, "v2", 2])
	})

	it("breaks ties on equal demand by video_id ascending (cursor predicate)", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "v_tie_b",
					song: "Sb",
					artist: "Ab",
					thumbnail_url: null,
					demand: 5,
					request_count: 5,
				},
				{
					video_id: "v_tie_c",
					song: "Sc",
					artist: "Ac",
					thumbnail_url: null,
					demand: 5,
					request_count: 5,
				},
			],
		])
		const env = makeEnv(db)
		const { items } = await getMostWantedPage(
			env,
			{ demand: 5, videoId: "v_tie_a", cutoff: 1_700_000_000, lastRank: 0 },
			5
		)
		expect(items.map((r) => r.videoId)).toEqual(["v_tie_b", "v_tie_c"])
		expect(db.calls[0].params).toEqual([1_700_000_000, 5, 5, "v_tie_a", 5])
	})

	it("returns a null nextCursor on the last page", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "vLast",
					song: "S",
					artist: "A",
					thumbnail_url: null,
					demand: 1,
					request_count: 1,
				},
			],
		])
		const env = makeEnv(db)
		const { items, nextCursor } = await getMostWantedPage(
			env,
			{ demand: 2, videoId: "v4", cutoff: 1_700_000_000, lastRank: 30 },
			50
		)
		expect(items).toHaveLength(1)
		expect(items[0].rank).toBe(31)
		expect(nextCursor).toBeNull()
	})
})

describe("getCuratorLeaderboard", () => {
	it("returns curators ranked by summed effective score", async () => {
		const db = makeMockDB([
			[
				{ key_id: "k1", reputation: 1.8, score: 42.5, submission_count: 12, total_upvotes: 80 },
				{ key_id: "k2", reputation: 1.1, score: 9.0, submission_count: 3, total_upvotes: 11 },
			],
		])
		const env = makeEnv(db)
		const result = await getCuratorLeaderboard(env, 200)
		expect(result[0]).toMatchObject({ keyId: "k1", rank: 1, score: 42.5 })
		expect(result[1].rank).toBe(2)
	})
})

describe("getCuratorLeaderboard fulfillment fields", () => {
	it("returns fulfilledCount and fulfilledDemand on each row", async () => {
		const db = makeMockDB([
			[
				{
					key_id: "k1",
					reputation: 1.5,
					score: 30,
					submission_count: 8,
					total_upvotes: 50,
					fulfilled_count: 4,
					fulfilled_demand: 12.5,
				},
				{
					key_id: "k2",
					reputation: 1.0,
					score: 5,
					submission_count: 2,
					total_upvotes: 7,
					fulfilled_count: 0,
					fulfilled_demand: 0,
				},
			],
		])
		const env = makeEnv(db)

		const result = await getCuratorLeaderboard(env, 200)

		expect(result[0]).toMatchObject({
			keyId: "k1",
			fulfilledCount: 4,
			fulfilledDemand: 12.5,
		})
		expect(result[1]).toMatchObject({
			keyId: "k2",
			fulfilledCount: 0,
			fulfilledDemand: 0,
		})
	})

	it("joins against live fulfillments (filters deleted/auto-hidden)", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)

		await getCuratorLeaderboard(env, 200)

		const sql = db.calls[0].sql
		expect(sql).toMatch(/request_fulfillments/i)
		expect(sql).toMatch(/l\.deleted_at\s+IS\s+NULL/i)
	})
})
