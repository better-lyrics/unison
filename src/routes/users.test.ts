import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { userRoutes } from "./users"

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
		const res = await app.handle(new Request("http://localhost/users/k1/submissions"))
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
				nextCursor?: number
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
		const res = await app.handle(new Request("http://localhost/users/nobody/submissions"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { submissions: unknown[]; nextCursor?: number }
		}
		expect(json.success).toBe(true)
		expect(json.data.submissions).toEqual([])
		expect(json.data.nextCursor).toBeUndefined()
	})

	it("sets nextCursor to the last kept row's created_at when limit+1 rows are returned", async () => {
		const rows = Array.from({ length: 3 }, (_, i) =>
			rawRow({ id: i + 1, video_id: `v${i + 1}`, created_at: 1700000000 - i })
		)
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request("http://localhost/users/k1/submissions?limit=2"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: number }
		}
		expect(json.data.submissions.length).toBe(2)
		expect(json.data.nextCursor).toBe(1700000000 - 1)
		expect(db.calls[0].params).toEqual(["k1", 3])
	})

	it("omits nextCursor when fewer than limit+1 rows are returned", async () => {
		const rows = Array.from({ length: 2 }, (_, i) => rawRow({ id: i + 1, video_id: `v${i + 1}` }))
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(new Request("http://localhost/users/k1/submissions?limit=2"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: number }
		}
		expect(json.data.submissions.length).toBe(2)
		expect(json.data.nextCursor).toBeUndefined()
	})

	it("respects an explicit cursor and uses it as a created_at upper bound", async () => {
		const rows = [
			rawRow({ id: 10, created_at: 1699999900 }),
			rawRow({ id: 11, created_at: 1699999800 }),
			rawRow({ id: 12, created_at: 1699999700 }),
		]
		const db = makeMockDB([rows])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/k1/submissions?limit=2&cursor=1700000000")
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { submissions: unknown[]; nextCursor?: number }
		}
		expect(json.data.nextCursor).toBe(1699999800)
		expect(db.calls[0].params).toEqual(["k1", 1700000000, 3])
	})

	it("rejects a negative cursor", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/k1/submissions?cursor=-1")
		)
		expect(res.status).toBeGreaterThanOrEqual(400)
	})

	it("rejects a limit above the maximum", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/k1/submissions?limit=100")
		)
		expect(res.status).toBeGreaterThanOrEqual(400)
	})
})
