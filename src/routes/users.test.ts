import { config } from "@/config"
import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"
import { userRoutes } from "./users"

vi.mock("@/db/users", async () => {
	const actual = await vi.importActual<typeof import("@/db/users")>("@/db/users")
	return {
		...actual,
		getOrCreateUser: vi.fn(async (_env: unknown, keyId: string) => ({
			id: 42,
			key_id: keyId,
			reputation: 1,
			vote_count: 0,
			avg_vote: 0,
			created_at: 0,
		})),
	}
})

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
	return {
		store,
		async get(key: string) {
			return store[key] ?? null
		},
		async put(key: string, value: string) {
			store[key] = value
		},
		async delete(key: string) {
			delete store[key]
		},
		async keys() {
			return Object.keys(store)
		},
		async setNX(key: string, value: string) {
			if (store[key] !== undefined) return false
			store[key] = value
			return true
		},
	}
}

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache> = makeMockCache()
): Env {
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
	}
}

function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store[`session:${token}`] = JSON.stringify({
		keyId,
		issuedAt,
		expiresAt: issuedAt + 600,
	})
}

function rawRow(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		video_id: "v1",
		song: "Song",
		artist: "Artist",
		album: null,
		duration: 200,
		format: "lrc",
		sync_type: "linesync",
		language: null,
		effective_score: 1,
		vote_count: 1,
		confidence: "low",
		created_at: 1700000000,
		hidden: false,
		...over,
	}
}

const KEY = "a".repeat(64)
const OTHER_KEY = "b".repeat(64)

describe("GET /users/by-handle/:handle", () => {
	it("resolves a handle to its key id", async () => {
		const db = makeMockDB([{ key_id: KEY }])
		const app = userRoutes(makeEnv(db))
		const res = await app.handle(new Request("http://localhost/users/by-handle/aurora"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as { data: { keyId: string } }
		expect(json.data.keyId).toBe(KEY)
		expect(db.calls[0].sql).toBe("SELECT key_id FROM users WHERE nickname_lower = ?")
		expect(db.calls[0].params).toEqual(["aurora"])
	})

	it("lowercases the handle before resolving", async () => {
		const db = makeMockDB([{ key_id: KEY }])
		const app = userRoutes(makeEnv(db))
		const res = await app.handle(new Request("http://localhost/users/by-handle/Aurora"))
		expect(res.status).toBe(200)
		expect(db.calls[0].params).toEqual(["aurora"])
	})

	it("returns 404 when no curator has that handle", async () => {
		const db = makeMockDB([null])
		const app = userRoutes(makeEnv(db))
		const res = await app.handle(new Request("http://localhost/users/by-handle/ghost"))
		expect(res.status).toBe(404)
	})

	it("rejects a handle shorter than the nickname minimum", async () => {
		const db = makeMockDB([])
		const app = userRoutes(makeEnv(db))
		const res = await app.handle(new Request("http://localhost/users/by-handle/ab"))
		expect(res.status).toBeGreaterThanOrEqual(400)
	})
})

describe("GET /users/:keyId/submissions", () => {
	it("returns submissions for a known user", async () => {
		const db = makeMockDB([
			[
				rawRow({ id: 10, video_id: "vA", created_at: 1700000200, hidden: false }),
				rawRow({ id: 11, video_id: "vB", created_at: 1700000100, hidden: true }),
			],
		])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${KEY}/submissions`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: {
				submissions: Array<{
					id: number
					videoId: string
					createdAt: number
					hidden: boolean
				}>
				nextCursor?: string
			}
		}
		expect(json.success).toBe(true)
		expect(json.data.submissions.length).toBe(2)
		expect(json.data.submissions[0].videoId).toBe("vA")
		expect(json.data.submissions[0].hidden).toBe(false)
		expect(json.data.submissions[1].hidden).toBe(true)
		expect(json.data.nextCursor).toBeUndefined()
	})

	it("returns an empty array for an unknown user", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${OTHER_KEY}/submissions`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { submissions: unknown[]; nextCursor?: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.submissions).toEqual([])
		expect(json.data.nextCursor).toBeUndefined()
	})

	it("sets nextCursor to the last kept row's (createdAt:id) when limit+1 rows are returned", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			rawRow({ id: i + 1, video_id: `v${i + 1}`, created_at: 1700000000 - i })
		)
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${KEY}/submissions?limit=2`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: string }
		}
		expect(json.data.submissions.length).toBe(2)
		expect(json.data.nextCursor).toBe(`${1700000000 - 1}:2`)
		expect(db.calls[0].params).toEqual([KEY, 3])
	})

	it("omits nextCursor when fewer than limit+1 rows are returned", async () => {
		const rows = Array.from({ length: 2 }, (_, i) => rawRow({ id: i + 1, video_id: `v${i + 1}` }))
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${KEY}/submissions?limit=2`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: string }
		}
		expect(json.data.submissions.length).toBe(2)
		expect(json.data.nextCursor).toBeUndefined()
	})

	it("respects an explicit cursor and uses it as a (createdAt, id) upper bound", async () => {
		const rows = [
			rawRow({ id: 10, created_at: 1699999900 }),
			rawRow({ id: 11, created_at: 1699999800 }),
			rawRow({ id: 12, created_at: 1699999700 }),
		]
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request(`http://localhost/users/${KEY}/submissions?limit=2&cursor=1700000000:99`)
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: string }
		}
		expect(json.data.nextCursor).toBe("1699999800:11")
		expect(db.calls[0].params).toEqual([KEY, 1700000000, 99, 3])
		expect(db.calls[0].sql).toContain("(l.created_at, l.id) < (?, ?)")
	})

	it("rejects a malformed cursor", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request(`http://localhost/users/${KEY}/submissions?cursor=not-a-cursor`)
		)
		expect(res.status).toBeGreaterThanOrEqual(400)
	})

	it("rejects a limit above the maximum", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${KEY}/submissions?limit=100`))
		expect(res.status).toBeGreaterThanOrEqual(400)
	})

	it("rejects a keyId that is not 64 hex characters", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request("http://localhost/users/ab/submissions"))
		expect(res.status).toBeGreaterThanOrEqual(400)
		expect(db.calls.length).toBe(0)
	})
})

describe("GET /users/:keyId/stats", () => {
	it("returns zero stats when the user has no fulfillments", async () => {
		const db = makeMockDB([{ id: 9 }, null])
		const env = makeEnv(db)
		const app = userRoutes(env)

		const res = await app.handle(new Request(`http://localhost/users/${KEY}/stats`))
		const body = (await res.json()) as { success: boolean; data: unknown }

		expect(body.success).toBe(true)
		expect(body.data).toEqual({ fulfilledCount: 0, fulfilledDemand: 0 })
	})

	it("returns counts when the user has fulfillments", async () => {
		const db = makeMockDB([{ id: 9 }, { count: 3, demand: 7.5 }])
		const env = makeEnv(db)
		const app = userRoutes(env)

		const res = await app.handle(new Request(`http://localhost/users/${KEY}/stats`))
		const body = (await res.json()) as { success: boolean; data: unknown }

		expect(body.data).toEqual({ fulfilledCount: 3, fulfilledDemand: 7.5 })
	})

	it("returns 404 when the user does not exist", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const app = userRoutes(env)

		const res = await app.handle(new Request(`http://localhost/users/${KEY}/stats`))
		expect(res.status).toBe(404)
	})
})

describe("GET /users/:keyId/badges", () => {
	it("returns the zero-state gamification profile for an unknown user", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${KEY}/badges`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: {
				keyId: string
				level: number
				xp: number
				xpForNext: number | null
				tier: string | null
				tierRank: number | null
				badges: unknown[]
				featured: unknown[]
				counts: { earned: number; total: number }
			}
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(KEY)
		expect(json.data.badges).toEqual([])
		expect(json.data.featured).toEqual([])
		expect(json.data.counts.earned).toBe(0)
		expect(json.data.counts.total).toBeGreaterThan(0)
		expect(json.data.xp).toBe(0)
		expect(json.data.tier).toBeNull()
		expect(json.data.tierRank).toBeNull()
		expect(typeof json.data.level).toBe("number")
		expect(json.data.xpForNext).not.toBeUndefined()
	})

	it("rejects a keyId that is not 64 hex characters", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request("http://localhost/users/xyz/badges"))
		expect(res.status).toBeGreaterThanOrEqual(400)
		expect(db.calls.length).toBe(0)
	})
})

describe("PUT /users/me/featured-badges", () => {
	it("returns 401 when the request is unauthenticated", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", { method: "PUT" })
		)
		expect(res.status).toBe(401)
	})

	it("returns 400 when the list exceeds the featured cap", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([])
		const env = makeEnv(db, cache)
		const app = userRoutes(env)
		const overCap = Array.from(
			{ length: config.gamification.featured.maxSlots + 1 },
			(_, i) => `first-submission-${i}`
		)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ featured: overCap }),
			})
		)
		expect(res.status).toBe(400)
	})

	it("returns 400 when a featured key has not been earned", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([[]])
		const env = makeEnv(db, cache)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ featured: ["committee"] }),
			})
		)
		expect(res.status).toBe(400)
	})

	it("returns 400 when the body is not a string array", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([])
		const env = makeEnv(db, cache)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ featured: "not-an-array" }),
			})
		)
		expect(res.status).toBe(400)
	})
})
