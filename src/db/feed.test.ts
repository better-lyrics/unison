import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { evictFeedCaches, getGlobalFeed, getMySubmissions, getPersonalizedFeed } from "./feed"
import { AUTO_HIDE_PREDICATE } from "./predicates"

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
	put(key?: string, value?: string, opts?: unknown): Promise<void>
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

function createRecordingCache() {
	const gets: string[] = []
	const puts: string[] = []
	const cache: MockCache = {
		async get(key: string) {
			gets.push(key)
			return null
		},
		async put(key?: string) {
			puts.push(String(key))
		},
		async delete() {},
	}
	return { cache, gets, puts }
}

async function flushMicrotasks() {
	await new Promise((r) => setImmediate(r))
}

function createEnv(db: MockDB, cache: MockCache = createMockCache()): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		CDN: null,
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

	it("keeps SQL shape unchanged when no filters supplied", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 0)

		const sql = db.calls[0].sql
		expect(sql).toContain("DISTINCT ON (video_id)")
		expect(sql).toContain("effective_score > 0")
		expect(sql).toContain("deleted_at IS NULL")
		expect(sql).toContain("LN(")
		expect(sql).not.toContain("created_at DESC, id DESC")
	})

	it("sort=newest changes outer ORDER BY but leaves inner DISTINCT ON alone", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 0, undefined, { sort: "newest", sortDir: "desc" })

		const sql = db.calls[0].sql
		expect(sql).toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(sql).toMatch(/ORDER BY video_id,.*sync_type.*DESC/s)
	})

	it("appends syncType, tier, and language predicates to the inner WHERE", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 0, undefined, {
			syncType: "richsync",
			tier: "trusted-plus",
			language: "ja",
		})

		const sql = db.calls[0].sql
		expect(sql).toContain("sync_type = ?")
		expect(sql).toContain("confidence IN ('medium', 'high')")
		expect(sql).toContain("language = ?")
		expect(sql).not.toContain("OFFSET")
		expect(db.calls[0].params).toEqual(["richsync", "ja", 20])
	})

	it("orders params as filterParams, excludeIds, limit, offset", async () => {
		const db = createMockDB([[]])
		await getGlobalFeed(createEnv(db), 20, 40, [10, 20], { syncType: "richsync" })

		expect(db.calls[0].params).toEqual(["richsync", 10, 20, 20, 40])
	})

	it("does NOT read or write cache when any filter is present", async () => {
		const { cache, gets, puts } = createRecordingCache()
		const db = createMockDB([[{ id: 1 }]])
		await getGlobalFeed(createEnv(db, cache), 20, 0, undefined, { sort: "newest" })

		await flushMicrotasks()
		expect(gets).toEqual([])
		expect(puts).toEqual([])
	})

	it("reads and writes cache when no filters are present (regression)", async () => {
		const { cache, gets, puts } = createRecordingCache()
		const db = createMockDB([[{ id: 1 }]])
		await getGlobalFeed(createEnv(db, cache), 20, 0)

		await flushMicrotasks()
		expect(gets).toEqual(["feed:global:20"])
		expect(puts).toEqual(["feed:global:20"])
	})

	it("treats sort=default as no filter for cache purposes", async () => {
		const { cache, gets, puts } = createRecordingCache()
		const db = createMockDB([[{ id: 1 }]])
		await getGlobalFeed(createEnv(db, cache), 20, 0, undefined, { sort: "default" })

		await flushMicrotasks()
		expect(gets).toEqual(["feed:global:20"])
		expect(puts).toEqual(["feed:global:20"])
	})

	it("returns cached result without hitting the DB when cache HIT", async () => {
		const cache: MockCache = {
			async get(key: string) {
				if (key === "feed:global:20") return JSON.stringify([{ id: 1 }])
				return null
			},
			async put() {},
			async delete() {},
		}
		const db = createMockDB([])
		const result = await getGlobalFeed(createEnv(db, cache), 20, 0)

		expect(db.calls).toHaveLength(0)
		expect(result).toEqual([{ id: 1 }])
	})

	describe("sealed cache", () => {
		it("caches page 0 of the sealed feed under a key per sort and limit", async () => {
			const { cache, gets, puts } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[{ id: 1 }]]), cache), 12, 0, undefined, {
				sealed: true,
				sort: "recently-sealed",
			})
			await flushMicrotasks()
			expect(gets).toEqual(["feed:sealed:recently-sealed:12"])
			expect(puts).toEqual(["feed:sealed:recently-sealed:12"])
		})

		it("names the default sort in the key when no sort is given", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, undefined, { sealed: true })
			expect(gets).toEqual(["feed:sealed:default:12"])
		})

		it("keeps sortDir=desc on the same key as no sortDir", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, undefined, {
				sealed: true,
				sort: "top-rated",
				sortDir: "desc",
			})
			expect(gets).toEqual(["feed:sealed:top-rated:12"])
		})

		it("serves a cached sealed page without touching the DB", async () => {
			const cache: MockCache = {
				async get(key: string) {
					return key === "feed:sealed:default:12" ? JSON.stringify([{ id: 9 }]) : null
				},
				async put() {},
				async delete() {},
			}
			const db = createMockDB([])
			const result = await getGlobalFeed(createEnv(db, cache), 12, 0, undefined, { sealed: true })
			expect(db.calls).toHaveLength(0)
			expect(result).toEqual([{ id: 9 }])
		})
	})

	describe("sealed cache edge cases", () => {
		it("does not cache sealed pages after page 0", async () => {
			const { cache, gets, puts } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 12, undefined, {
				sealed: true,
			})
			await flushMicrotasks()
			expect(gets).toEqual([])
			expect(puts).toEqual([])
		})

		it("does not cache sealed queries that also filter by syncType", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, undefined, {
				sealed: true,
				syncType: "richsync",
			})
			expect(gets).toEqual([])
		})

		it("does not cache sealed queries with sortDir=asc", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, undefined, {
				sealed: true,
				sort: "top-rated",
				sortDir: "asc",
			})
			expect(gets).toEqual([])
		})

		it("does not cache sealed queries with exclusions", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, [3], { sealed: true })
			expect(gets).toEqual([])
		})
	})

	describe("sealed cache regressions", () => {
		it("regression: a non-sealed sort still skips the cache", async () => {
			const { cache, gets } = createRecordingCache()
			await getGlobalFeed(createEnv(createMockDB([[]]), cache), 12, 0, undefined, {
				sort: "recently-sealed",
			})
			expect(gets).toEqual([])
		})

		it("regression: the sealed query keeps the seal predicate in the inner WHERE", async () => {
			const db = createMockDB([[]])
			await getGlobalFeed(createEnv(db), 12, 0, undefined, { sealed: true })
			const sql = db.calls[0]?.sql ?? ""
			const inner = sql.slice(sql.indexOf("WHERE"), sql.indexOf(") AS unique_videos"))
			expect(inner).toContain("committee_approved_at IS NOT NULL")
		})
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

	it("appends filter predicates to the inner WHERE alongside the baseline gate", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, {
			syncType: "richsync",
			tier: "top-rated",
		})

		const feedSql = db.calls[1].sql
		expect(feedSql).toContain("sync_type = ?")
		expect(feedSql).toContain("confidence = 'high'")
		expect(feedSql).toContain("effective_score > 0")
		expect(feedSql).toContain("deleted_at IS NULL")
		expect(feedSql).not.toContain("confidence IN ('medium', 'high')")
	})

	it("keeps the effective_score quality gate even with sort=newest", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, { sort: "newest", sortDir: "desc" })

		const feedSql = db.calls[1].sql
		expect(feedSql).toContain("effective_score > 0")
		expect(feedSql).toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(feedSql).not.toMatch(/ORDER BY\s+is_personalized DESC/)
		expect(feedSql).toMatch(/ORDER BY video_id,.*LN\(/s)
	})

	it("binds artists, userId, filter params, limit in left-to-right SQL order", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, {
			syncType: "richsync",
			language: "ja",
		})

		expect(db.calls[1].params).toEqual(["limbo", 42, "richsync", "ja", 20])
	})

	it("binds offset last when offset > 0 with filters present", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 40, {
			syncType: "richsync",
			language: "ja",
		})

		expect(db.calls[1].sql).toContain("LIMIT ? OFFSET ?")
		expect(db.calls[1].params).toEqual(["limbo", 42, "richsync", "ja", 20, 40])
	})

	it("forwards filters to the global fallback when user has no preferred artists", async () => {
		const db = createMockDB([[], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, { sort: "newest", sortDir: "desc" })

		const feedSql = db.calls[1].sql
		expect(feedSql).toMatch(/ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(feedSql).not.toContain("is_personalized")
	})

	it("drops the is_personalized boost when an explicit sort is chosen (most-voted)", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, {
			sort: "most-voted",
			sortDir: "desc",
		})

		const feedSql = db.calls[1].sql
		expect(feedSql).toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY\s+vote_count DESC,\s+id DESC/)
		expect(feedSql).not.toMatch(/ORDER BY\s+is_personalized DESC/)
	})

	it("regression: explicit sorts honor the label instead of pinning preferred artists on top", async () => {
		// Bug: is_personalized DESC was always the primary outer sort key, so a
		// logged-in user's preferred-artist items pinned above everything and the
		// chosen sort only ordered within that tier. The true most-voted / newest
		// item landed on page 2. Explicit sorts must match the global ordering.
		for (const sort of ["newest", "top-rated", "most-voted"] as const) {
			const db = createMockDB([[{ artist_norm: "limbo" }], []])
			await getPersonalizedFeed(createEnv(db), 42, 20, 0, { sort, sortDir: "desc" })
			expect(db.calls[1].sql).not.toMatch(/ORDER BY\s+is_personalized DESC/)
		}
	})

	it("keeps the is_personalized boost on the default feed (no explicit sort)", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0, { sort: "default" })

		const feedSql = db.calls[1].sql
		expect(feedSql).toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY\s+is_personalized DESC/)
	})

	it("keeps SQL shape unchanged when filters are absent (regression)", async () => {
		const db = createMockDB([[{ artist_norm: "limbo" }], []])
		await getPersonalizedFeed(createEnv(db), 42, 20, 0)

		const feedSql = db.calls[1].sql
		expect(feedSql).toMatch(/ORDER BY is_personalized DESC,.*LN\(/s)
		expect(feedSql).not.toMatch(/\)\s*AS\s+unique_videos\s+ORDER BY[^L]*created_at DESC/)
	})
})

// -- getMySubmissions ------------------------------------------------------

describe("getMySubmissions", () => {
	it("uses offset pagination with id tiebreaker in default order", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 40)

		const sql = db.calls[0].sql
		expect(sql).toContain("LIMIT ? OFFSET ?")
		expect(sql).toMatch(/ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(sql).not.toContain("created_at < ?")
		expect(db.calls[0].params).toEqual([42, 20, 40])
	})

	it("omits OFFSET when offset is 0", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 0)

		const sql = db.calls[0].sql
		expect(sql).not.toContain("OFFSET")
		expect(db.calls[0].params).toEqual([42, 20])
	})

	it("omits OFFSET when offset is undefined", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20)

		const sql = db.calls[0].sql
		expect(sql).not.toContain("OFFSET")
		expect(db.calls[0].params).toEqual([42, 20])
	})

	it("selects the auto-hide predicate as a hidden column", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20)
		const sql = db.calls[0].sql
		expect(sql).toMatch(/AS\s+hidden/i)
		expect(sql).toContain(AUTO_HIDE_PREDICATE)
	})

	it("sort=most-voted changes ORDER BY with desc tiebreaker", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 0, {
			sort: "most-voted",
			sortDir: "desc",
		})

		const sql = db.calls[0].sql
		expect(sql).toMatch(/ORDER BY\s+vote_count DESC,\s+id DESC/)
	})

	it("sort=top-rated asc matches the tiebreaker direction", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 0, {
			sort: "top-rated",
			sortDir: "asc",
		})

		const sql = db.calls[0].sql
		expect(sql).toMatch(/ORDER BY\s+effective_score ASC,\s+vote_count ASC,\s+id ASC/)
	})

	it("applies filters without adding a quality gate", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 0, {
			syncType: "richsync",
			tier: "top-rated",
		})

		const sql = db.calls[0].sql
		expect(sql).toContain("sync_type = ?")
		expect(sql).toContain("confidence = 'high'")
		expect(sql).not.toContain("effective_score > 0")
		expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})

	it("binds userId, filter params, limit, offset in order", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 40, {
			syncType: "richsync",
			language: "ja",
		})

		expect(db.calls[0].params).toEqual([42, "richsync", "ja", 20, 40])
		expect(db.calls[0].params[0]).toBe(42)
	})

	it("keeps deleted_at IS NULL when filters are present", async () => {
		const db = createMockDB([[]])
		await getMySubmissions(createEnv(db), 42, 20, 0, {
			sort: "newest",
			syncType: "richsync",
		})

		const sql = db.calls[0].sql
		expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
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

describe("evictFeedCaches", () => {
	function keyedCache(keys: string[]) {
		const store = new Set(keys)
		const deleted: string[] = []
		return {
			deleted,
			store,
			cache: {
				async get() {
					return null
				},
				async put() {},
				async delete(key: string) {
					deleted.push(key)
					store.delete(key)
				},
				async keys(pattern: string) {
					const prefix = pattern.replace(/\*$/, "")
					return [...store].filter((k) => k.startsWith(prefix))
				},
			},
		}
	}

	it("deletes every global and sealed feed page", async () => {
		const { cache, deleted } = keyedCache([
			"feed:global:20",
			"feed:sealed:default:12",
			"feed:sealed:top-rated:24",
		])
		await evictFeedCaches(createEnv(createMockDB(), cache as unknown as MockCache))
		expect(deleted.sort()).toEqual([
			"feed:global:20",
			"feed:sealed:default:12",
			"feed:sealed:top-rated:24",
		])
	})

	it("leaves every other key alone", async () => {
		const { cache, store } = keyedCache([
			"v:abc",
			"feed:mine:1",
			"leaderboard:songs",
			"feed:global:20",
		])
		await evictFeedCaches(createEnv(createMockDB(), cache as unknown as MockCache))
		expect([...store].sort()).toEqual(["feed:mine:1", "leaderboard:songs", "v:abc"])
	})

	it("returns how many keys it cleared", async () => {
		const { cache } = keyedCache(["feed:global:20", "feed:sealed:default:12", "v:abc"])
		expect(await evictFeedCaches(createEnv(createMockDB(), cache as unknown as MockCache))).toBe(2)
	})

	it("is a no-op on an empty cache", async () => {
		const { cache, deleted } = keyedCache([])
		await evictFeedCaches(createEnv(createMockDB(), cache as unknown as MockCache))
		expect(deleted).toEqual([])
	})
})
