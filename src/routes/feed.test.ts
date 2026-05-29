import type { Env, FeedItem } from "@/types"
import { describe, expect, it } from "vitest"
import { feedRoutes, toFeedResponse } from "./feed"

const baseItem: FeedItem = {
	id: 1,
	video_id: "v",
	song: "S",
	artist: "A",
	album: null,
	isrc: null,
	duration: 100,
	format: "lrc",
	language: null,
	sync_type: "linesync",
	score: 0,
	effective_score: 0,
	vote_count: 0,
	confidence: "low",
	created_at: 1700000000,
}

describe("toFeedResponse", () => {
	it("defaults hidden to false when the row omits it", () => {
		expect(toFeedResponse(baseItem).hidden).toBe(false)
	})

	it("passes through hidden when present", () => {
		expect(toFeedResponse({ ...baseItem, hidden: true }).hidden).toBe(true)
	})
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

function makeFeedRow(overrides: Partial<FeedItem> = {}): FeedItem {
	return { ...baseItem, ...overrides }
}

describe("GET /feed", () => {
	it("issues baseline SQL with default RANKING_EXPR sort when no params are present", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed"))

		expect(res.status).toBe(200)
		const sql = db.calls[0].sql
		expect(sql).not.toContain("sync_type = ?")
		expect(sql).not.toContain("created_at DESC, id DESC")
		expect(sql).toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY\s+\(/)
	})

	it("forwards sort=newest into the outer ORDER BY", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?sort=newest&sortDir=desc"))

		expect(res.status).toBe(200)
		expect(db.calls[0].sql).toMatch(
			/\)\s*AS\s+unique_videos\s+ORDER BY\s+created_at DESC,\s+id DESC/
		)
	})

	it("forwards syncType, tier, and language filter params into SQL and bound params", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/feed?syncType=richsync&tier=top-rated&language=ja")
		)

		expect(res.status).toBe(200)
		const { sql, params } = db.calls[0]
		expect(sql).toContain("sync_type = ?")
		expect(sql).toContain("confidence = 'high'")
		expect(sql).toContain("language = ?")
		expect(params).toContain("richsync")
		expect(params).toContain("ja")
	})

	it("returns 200 and baseline SQL when sort and syncType values are unknown", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?sort=garbage&syncType=xml"))

		expect(res.status).toBe(200)
		const sql = db.calls[0].sql
		expect(sql).not.toContain("sync_type = ?")
		expect(sql).not.toContain("created_at DESC, id DESC")
	})

	it("treats a non-numeric cursor as offset 0", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?cursor=abc"))

		expect(res.status).toBe(200)
		expect(db.calls[0].sql).not.toContain("OFFSET")
	})

	it("treats a negative cursor as offset 0", async () => {
		const db = makeMockDB([[]])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?cursor=-5"))

		expect(res.status).toBe(200)
		expect(db.calls[0].sql).not.toContain("OFFSET")
	})

	it("emits nextCursor as offset + items.length when the page is full", async () => {
		const rows = Array.from({ length: 20 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([rows])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?limit=20"))
		const body = (await res.json()) as { nextCursor?: number; data: unknown[] }

		expect(res.status).toBe(200)
		expect(body.data).toHaveLength(20)
		expect(body.nextCursor).toBe(20)
	})

	it("routes authenticated requests to getPersonalizedFeed and forwards filters", async () => {
		const db = makeMockDB([
			{ id: 42 },
			[{ artist_norm: "limbo" }],
			[],
		])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/feed?sort=newest&syncType=richsync", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		expect(db.calls[0].sql).toContain("FROM users WHERE key_id = ?")
		expect(db.calls[1].sql).toContain("FROM votes")
		const feedSql = db.calls[2].sql
		expect(feedSql).toContain("is_personalized")
		expect(feedSql).toContain("sync_type = ?")
		expect(feedSql).toMatch(/ORDER BY\s+is_personalized DESC,\s+created_at DESC,\s+id DESC/)
		expect(db.calls[2].params).toContain("richsync")
	})

	it("omits nextCursor when the page is short", async () => {
		const rows = Array.from({ length: 3 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([rows])
		const app = feedRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/feed?limit=20"))
		const body = (await res.json()) as { nextCursor?: number; data: unknown[] }

		expect(res.status).toBe(200)
		expect(body.data).toHaveLength(3)
		expect(body.nextCursor).toBeUndefined()
	})
})
