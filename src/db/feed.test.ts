import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getGlobalFeed, getMySubmissions, getPersonalizedFeed } from "./feed"

// -- Mocks -----------------------------------------------------------------

interface DBStep {
	sql: string
	params: unknown[]
}

class MockPreparedStatement {
	constructor(
		readonly sql: string,
		private readonly db: MockDB
	) {}
	private params: unknown[] = []

	bind(...args: unknown[]): MockPreparedStatement {
		this.params = args
		return this
	}

	async first<T>(): Promise<T | null> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		const next = this.db.queue.shift()
		return (next as T) ?? null
	}

	async all<T>(): Promise<{ results: T[] }> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		const next = this.db.queue.shift()
		return { results: (next as T[]) ?? [] }
	}
}

interface MockDB {
	calls: DBStep[]
	queue: unknown[]
	prepare(sql: string): MockPreparedStatement
}

function createMockDB(queue: unknown[] = []): MockDB {
	const calls: DBStep[] = []
	const db: MockDB = {
		calls,
		queue,
		prepare(sql: string) {
			return new MockPreparedStatement(sql, db)
		},
	}
	return db
}

interface MockCache {
	get(key: string): Promise<string | null>
	put(): Promise<void>
	delete(key: string): Promise<void>
}

function createMockCache(): MockCache {
	return {
		async get() {
			return null
		},
		async put() {},
		async delete() {},
	}
}

function createEnv(db: MockDB, cache: MockCache = createMockCache()): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
	}
}

afterEach(() => {
	vi.clearAllMocks()
})

// -- getGlobalFeed ---------------------------------------------------------

describe("getGlobalFeed", () => {
	it("uses LIMIT only when offset is 0", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 0)

		const sql = db.calls[0].sql
		expect(sql).toContain("LIMIT ?")
		expect(sql).not.toContain("OFFSET")
	})

	it("appends OFFSET clause when offset > 0", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 40)

		const sql = db.calls[0].sql
		expect(sql).toContain("LIMIT ? OFFSET ?")
		// params: [limit, offset]
		expect(db.calls[0].params).toEqual([20, 40])
	})

	it("excludes ids when excludeIds is non-empty", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 5, 0, [10, 20])

		const sql = db.calls[0].sql
		expect(sql).toContain("id NOT IN (?, ?)")
		expect(db.calls[0].params).toEqual([10, 20, 5])
	})
})

// -- getPersonalizedFeed: pagination correctness ---------------------------

describe("getPersonalizedFeed", () => {
	it("falls through to global when user has no preferred artists", async () => {
		const db = createMockDB([
			[], // artists query → empty
			[], // global feed query
		])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		// 1st call: artists lookup
		expect(db.calls[0].sql).toContain("FROM votes")
		// 2nd call: global feed (no personalized boost SQL)
		expect(db.calls[1].sql).not.toContain("is_personalized")
	})

	it("emits a SINGLE unified query with is_personalized boost when user has preferred artists", async () => {
		const db = createMockDB([
			[{ artist_norm: "limbo" }, { artist_norm: "don toliver" }], // artists
			[], // unified feed query
		])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		// Exactly two queries: artists lookup + unified feed
		expect(db.calls).toHaveLength(2)

		const feedSql = db.calls[1].sql
		expect(feedSql).toContain("is_personalized")
		expect(feedSql).toContain("ORDER BY is_personalized DESC")
	})

	it("does NOT issue a separate global-fill query (regression: cross-page duplicates)", async () => {
		// Simulates the user's bug scenario: only 1 personalized item, page size 20.
		// Old code did personalized SELECT + global fill SELECT (2 feed queries)
		// and offset=20 caused the personalized item to also appear in page 2's
		// global slice. New code uses a single SELECT, so this stays at 2 calls
		// total (artists lookup + unified feed) regardless of how few rows match.
		const db = createMockDB([
			[{ artist_norm: "limbo" }],
			[{ id: 62 }], // only 1 personalized-eligible item
		])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		expect(db.calls).toHaveLength(2)
		// Exactly one feed-shaped query (filtered by effective_score) - no global fill
		const feedQueries = db.calls.filter((c) => c.sql.includes("effective_score > 0"))
		expect(feedQueries).toHaveLength(1)
	})

	it("CASE excludes items the user has voted on from the personalized boost", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		const feedSql = db.calls[1].sql
		expect(feedSql).toContain("id NOT IN (SELECT lyrics_id FROM votes WHERE user_id = ?)")
	})

	it("binds artists, userId, and limit (offset omitted when 0)", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }, { artist_norm: "don toliver" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		// Order: ...artists, userId (for vote subquery), limit
		expect(db.calls[1].params).toEqual(["limbo", "don toliver", 42, 20])
		expect(db.calls[1].sql).not.toContain("OFFSET")
	})

	it("appends offset to params and SQL when offset > 0", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 40)

		expect(db.calls[1].sql).toContain("LIMIT ? OFFSET ?")
		expect(db.calls[1].params).toEqual(["limbo", 42, 20, 40])
	})
})

// -- getMySubmissions ------------------------------------------------------

describe("getMySubmissions", () => {
	it("orders by created_at DESC and matches its cursor semantics", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 1700000000)

		const sql = db.calls[0].sql
		// cursor and sort align here, so this stream stays cursor-based
		expect(sql).toContain("created_at < ?")
		expect(sql).toContain("ORDER BY created_at DESC")
		expect(db.calls[0].params).toEqual([42, 1700000000, 20])
	})

	it("selects the auto-hide predicate as a hidden column", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20)
		expect(db.calls[0].sql).toMatch(/AS\s+hidden/i)
	})
})

// -- soft-delete filtering --------------------------------------------------

describe("feed queries filter deleted rows", () => {
	it("getGlobalFeed adds deleted_at IS NULL", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20)
		const sql = db.calls.map((c) => c.sql).join("\n")
		expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})

	it("getMySubmissions hides the submitter's own deleted entries", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20)
		expect(db.calls[0].sql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})

	it("getPersonalizedFeed filters outer query but NOT artist-discovery sub-query", async () => {
		const db = createMockDB([[{ artist_norm: "x" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20)
		const artistSql = db.calls[0].sql
		const feedSql = db.calls[1].sql
		expect(artistSql).not.toMatch(/deleted_at\s+IS\s+NULL/i)
		expect(feedSql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})
})
