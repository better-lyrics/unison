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

function makeMockCache(seed: Record<string, string> = {}) {
	const store: Record<string, string> = { ...seed }
	const puts: Array<{ key: string; value: string }> = []
	const deletes: string[] = []
	return {
		puts,
		deletes,
		async get(key: string) {
			return store[key] ?? null
		},
		async put(key: string, value: string) {
			store[key] = value
			puts.push({ key, value })
		},
		async delete(key: string) {
			delete store[key]
			deletes.push(key)
		},
		async keys() {
			return Object.keys(store)
		},
		async setNX() {
			return true
		},
	}
}

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache> = makeMockCache()
): Env & { cache: ReturnType<typeof makeMockCache> } {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		cache,
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

describe("GET /leaderboard/songs cursor pagination", () => {
	function makeRow(videoId: string, demand: number) {
		return {
			video_id: videoId,
			song: `S-${videoId}`,
			artist: `A-${videoId}`,
			thumbnail_url: null,
			demand,
			request_count: demand,
		}
	}

	it("returns the first page when cursor is empty and bypasses the cache", async () => {
		const cached = JSON.stringify({
			mostWanted: [{ videoId: "vCACHED" }],
			needsFixing: [],
		})
		const db = makeMockDB([[makeRow("v1", 9), makeRow("v2", 4)]])
		const env = makeEnv(db, makeMockCache({ "leaderboard:songs": cached }))
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/songs?cursor=&limit=2"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: Array<{ videoId: string; rank: number }>
			nextCursor: string | null
		}
		expect(json.data.map((r) => r.videoId)).toEqual(["v1", "v2"])
		expect(json.data[0].rank).toBe(1)
		expect(json.nextCursor).not.toBeNull()
		const havingCall = db.calls[0]
		expect(havingCall.sql).not.toContain("HAVING")
	})

	it("returns the next page when given the prior nextCursor", async () => {
		const first = makeMockDB([[makeRow("v1", 9), makeRow("v2", 4)]])
		const firstEnv = makeEnv(first)
		const firstApp = leaderboardRoutes(firstEnv)
		const firstRes = await firstApp.handle(
			new Request("http://localhost/leaderboard/songs?cursor=&limit=2")
		)
		const firstJson = (await firstRes.json()) as { nextCursor: string | null }
		const next = firstJson.nextCursor
		expect(next).not.toBeNull()

		const second = makeMockDB([[makeRow("v3", 3), makeRow("v4", 2)]])
		const env = makeEnv(second)
		const app = leaderboardRoutes(env)
		const res = await app.handle(
			new Request(
				`http://localhost/leaderboard/songs?cursor=${encodeURIComponent(next as string)}&limit=2`
			)
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: Array<{ videoId: string }>
			nextCursor: string | null
		}
		expect(json.data.map((r) => r.videoId)).toEqual(["v3", "v4"])
		expect(json.nextCursor).not.toBeNull()
		expect(second.calls[0].sql).toContain("HAVING")
	})

	it("returns a null nextCursor when the page is the last one", async () => {
		const db = makeMockDB([[makeRow("vLast", 1)]])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/songs?cursor=&limit=50"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as { nextCursor: string | null }
		expect(json.nextCursor).toBeNull()
	})

	it("clamps an oversized limit to 50", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/leaderboard/songs?cursor=&limit=200")
		)
		expect(res.status).toBe(200)
		const limitParam = db.calls[0].params[db.calls[0].params.length - 1]
		expect(limitParam).toBe(50)
	})

	it("returns 400 INVALID_CURSOR when the cursor is garbage", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/leaderboard/songs?cursor=garbage&limit=10")
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_CURSOR")
		expect(db.calls.length).toBe(0)
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

describe("GET /leaderboard/songs cache hit", () => {
	it("returns cached data without hitting the DB", async () => {
		const cached = JSON.stringify({
			mostWanted: [{ videoId: "vCACHED", rank: 1, section: "most_wanted" }],
			needsFixing: [],
		})
		const db = makeMockDB([])
		const env = makeEnv(db, makeMockCache({ "leaderboard:songs": cached }))
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/songs"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { mostWanted: Array<{ videoId: string }> }
		}
		expect(json.data.mostWanted[0].videoId).toBe("vCACHED")
		expect(db.calls.length).toBe(0)
	})
})

describe("GET /leaderboard/songs/:videoId", () => {
	it("returns ranked: false when the video is not on either section", async () => {
		const db = makeMockDB([[], []])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/songs/missing"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as { data: { ranked: boolean } }
		expect(json.data.ranked).toBe(false)
	})
})

describe("GET /leaderboard/users/:keyId", () => {
	it("returns ranked: true with displayName and lastVoteAt when the user is on the board", async () => {
		const keyId = "a".repeat(64)
		const db = makeMockDB([
			[{ key_id: keyId, reputation: 1.2, score: 5, submission_count: 2, total_upvotes: 8 }],
			{ last_vote_at: 1700000123 },
		])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request(`http://localhost/leaderboard/users/${keyId}`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: {
				ranked: boolean
				keyId?: string
				rank?: number
				displayName?: string
				lastVoteAt?: number | null
			}
		}
		expect(json.data.ranked).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.rank).toBe(1)
		expect(json.data.displayName?.length).toBeGreaterThan(0)
		expect(json.data.lastVoteAt).toBe(1700000123)
	})

	it("returns ranked: false with displayName and null lastVoteAt for an unknown user", async () => {
		const keyId = "b".repeat(64)
		const db = makeMockDB([[], { last_vote_at: null }])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request(`http://localhost/leaderboard/users/${keyId}`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: {
				ranked: boolean
				keyId?: string
				displayName?: string
				lastVoteAt?: number | null
			}
		}
		expect(json.data.ranked).toBe(false)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName?.length).toBeGreaterThan(0)
		expect(json.data.lastVoteAt).toBeNull()
	})

	it("rejects a keyId that is not 64 hex characters", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/users/ab"))
		expect(res.status).toBeGreaterThanOrEqual(400)
	})
})

describe("GET /leaderboard/users corrupt cache", () => {
	it("evicts the corrupt entry and recomputes from the DB", async () => {
		const db = makeMockDB([
			[
				{
					key_id: "a".repeat(64),
					reputation: 1.0,
					score: 1,
					submission_count: 1,
					total_upvotes: 1,
				},
			],
		])
		const env = makeEnv(db, makeMockCache({ "leaderboard:users": "not json {" }))
		const app = leaderboardRoutes(env)
		const res = await app.handle(new Request("http://localhost/leaderboard/users"))
		expect(res.status).toBe(200)
		expect(env.cache.deletes).toContain("leaderboard:users")
		const json = (await res.json()) as {
			data: { curators: Array<{ keyId: string }> }
		}
		expect(json.data.curators[0].keyId).toBe("a".repeat(64))
	})
})
