import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { leaderboardRoutes } from "./leaderboard"

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
	}
}

describe("GET /leaderboard/songs", () => {
	it("returns both sections", async () => {
		const db = makeMockDB([
			[
				{
					video_id: "v1",
					song: "S",
					artist: "A",
					thumbnail_url: null,
					demand: 5,
					request_count: 5,
				},
			],
			[],
		])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/songs"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: {
				mostWanted: Array<{ videoId: string; rank: number; section: string }>
				needsFixing: unknown[]
			}
		}
		expect(json.data.mostWanted[0].videoId).toBe("v1")
		expect(json.data.mostWanted[0].rank).toBe(1)
		expect(json.data.mostWanted[0].section).toBe("most_wanted")
		expect(json.data.needsFixing).toEqual([])
	})
})

describe("GET /leaderboard/users", () => {
	it("returns curators with display names", async () => {
		const db = makeMockDB([
			[
				{
					key_id: "a".repeat(64),
					reputation: 1.5,
					score: 10,
					submission_count: 4,
					total_upvotes: 20,
				},
			],
		])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/users"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { curators: Array<{ displayName: string; rank: number; keyId: string }> }
		}
		expect(json.data.curators[0].displayName.length).toBeGreaterThan(0)
		expect(json.data.curators[0].rank).toBe(1)
		expect(json.data.curators[0].keyId).toBe("a".repeat(64))
	})
})
