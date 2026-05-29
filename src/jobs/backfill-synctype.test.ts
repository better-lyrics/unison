import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { backfillSyncType } from "./backfill-synctype"

interface DBCall {
	sql: string
	params: unknown[]
}

function makeMockDB(scripted: Array<unknown[] | unknown>) {
	const calls: DBCall[] = []
	const queue = [...scripted]
	const db = {
		calls,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return (next as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return { results: (next as T[]) ?? [] }
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

function makeMockCache(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial))
	const deleteCalls: string[] = []
	const keysCalls: string[] = []
	return {
		store,
		deleteCalls,
		keysCalls,
		async get(key: string) {
			return store.get(key) ?? null
		},
		async put() {},
		async delete(key: string) {
			deleteCalls.push(key)
			store.delete(key)
		},
		async keys(pattern: string) {
			keysCalls.push(pattern)
			const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)
			return [...store.keys()].filter((k) => re.test(k))
		},
		async setNX() {
			return true
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>, cache: ReturnType<typeof makeMockCache>): Env {
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
	}
}

const RICHSYNC_TTML =
	'<tt><body><div><p begin="0:00.0" end="0:02.0">' +
	'<span begin="0:00.0" end="0:01.0">Hello</span> ' +
	'<span begin="0:01.0" end="0:02.0">world</span>' +
	"</p></div></body></tt>"

const LINESYNC_TTML =
	'<tt><body><div><p begin="0:00.0" end="0:02.0">Hello world</p></div></body></tt>'

const PLAIN_TTML = "<tt><body><div><p>Hello world</p></div></body></tt>"

describe("backfillSyncType", () => {
	it("only updates rows whose detected sync_type differs from current", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "linesync" },
				{ id: 2, video_id: "v2", format: "ttml", lyrics: LINESYNC_TTML, sync_type: "linesync" },
				{ id: 3, video_id: "v3", format: "ttml", lyrics: PLAIN_TTML, sync_type: "linesync" },
			],
			null,
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillSyncType(env)

		expect(result.scanned).toBe(3)
		expect(result.changed).toBe(2)
		const updates = db.calls.filter((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
		expect(updates[0].params).toEqual(["richsync", 1, "linesync"])
		expect(updates[1].params).toEqual(["plain", 3, "linesync"])
	})

	it("includes the WHERE-guard predicate against concurrent updates", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "linesync" }],
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		await backfillSyncType(env)

		const update = db.calls.find((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(update?.sql).toMatch(/WHERE\s+id\s*=\s*\?\s+AND\s+sync_type\s*=\s*\?/i)
	})

	it("invalidates the v: cache key for each updated row", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "vid_a", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "linesync" },
				{ id: 2, video_id: "vid_b", format: "ttml", lyrics: LINESYNC_TTML, sync_type: "linesync" },
			],
			null,
			[],
		])
		const cache = makeMockCache({ "v:vid_a": "stale", "v:vid_b": "stale" })
		const env = makeEnv(db, cache)

		await backfillSyncType(env)

		expect(cache.deleteCalls).toContain("v:vid_a")
		expect(cache.deleteCalls).not.toContain("v:vid_b")
	})

	it("clears feed:global:* keys exactly once at the end when any row was changed", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "linesync" }],
			null,
			[],
		])
		const cache = makeMockCache({
			"feed:global:20": "stale",
			"feed:global:50": "stale",
			unrelated: "keep",
		})
		const env = makeEnv(db, cache)

		await backfillSyncType(env)

		expect(cache.keysCalls.filter((p) => p === "feed:global:*")).toHaveLength(1)
		expect(cache.deleteCalls).toContain("feed:global:20")
		expect(cache.deleteCalls).toContain("feed:global:50")
		expect(cache.deleteCalls).not.toContain("unrelated")
	})

	it("does not purge feed:global:* when no row was changed", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" }],
			[],
		])
		const cache = makeMockCache({ "feed:global:20": "keep" })
		const env = makeEnv(db, cache)

		const result = await backfillSyncType(env)

		expect(result.changed).toBe(0)
		expect(cache.deleteCalls).not.toContain("feed:global:20")
	})

	it("paginates by id cursor and terminates on a short final batch", async () => {
		const db = makeMockDB([
			[
				{ id: 5, video_id: "v5", format: "ttml", lyrics: PLAIN_TTML, sync_type: "plain" },
				{ id: 9, video_id: "v9", format: "ttml", lyrics: PLAIN_TTML, sync_type: "plain" },
			],
			[{ id: 12, video_id: "v12", format: "ttml", lyrics: PLAIN_TTML, sync_type: "plain" }],
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillSyncType(env)

		expect(result.scanned).toBe(3)
		const selects = db.calls.filter((c) => /SELECT\b.*FROM\s+lyrics/i.test(c.sql))
		expect(selects).toHaveLength(3)
		expect(selects[0].params[0]).toBe(0)
		expect(selects[1].params[0]).toBe(9)
		expect(selects[2].params[0]).toBe(12)
	})
})
