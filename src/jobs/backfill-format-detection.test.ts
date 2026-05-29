import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { backfillFormatDetection } from "./backfill-format-detection"

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
		B2: null,
	}
}

const RICHSYNC_TTML =
	'<tt><body><div><p begin="0:00.0" end="0:02.0">' +
	'<span begin="0:00.0" end="0:01.0">Hello</span> ' +
	'<span begin="0:01.0" end="0:02.0">world</span>' +
	"</p></div></body></tt>"

const LINESYNC_LRC = "[00:01.00]Hello\n[00:03.00]World"

const PLAIN_PROSE = "Just some prose, no timing"

describe("backfillFormatDetection", () => {
	it("rewrites format and sync_type when stored values disagree with detected content", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "v1", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" },
				{ id: 2, video_id: "v2", format: "plain", lyrics: LINESYNC_LRC, sync_type: "plain" },
				{ id: 3, video_id: "v3", format: "plain", lyrics: PLAIN_PROSE, sync_type: "plain" },
			],
			null,
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.scanned).toBe(3)
		expect(result.changed).toBe(2)

		const updates = db.calls.filter((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
		expect(updates[0].params.slice(0, 2)).toEqual(["ttml", "richsync"])
		expect(updates[0].params[3]).toBe(1)
		expect(updates[1].params.slice(0, 2)).toEqual(["lrc", "linesync"])
		expect(updates[1].params[3]).toBe(2)
	})

	it("updates when format matches but sync_type drifts", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "plain" }],
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.changed).toBe(1)
		const update = db.calls.find((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(update?.params.slice(0, 2)).toEqual(["ttml", "richsync"])
	})

	it("updates when sync_type matches but format drifts", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "plain", lyrics: LINESYNC_LRC, sync_type: "linesync" }],
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.changed).toBe(1)
		const update = db.calls.find((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(update?.params.slice(0, 2)).toEqual(["lrc", "linesync"])
	})

	it("skips rows that already match the detected values", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" },
				{ id: 2, video_id: "v2", format: "lrc", lyrics: LINESYNC_LRC, sync_type: "linesync" },
			],
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.scanned).toBe(2)
		expect(result.changed).toBe(0)
		const updates = db.calls.filter((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(updates).toHaveLength(0)
	})

	it("includes the WHERE-guard predicate against concurrent updates", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" }],
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		const update = db.calls.find((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(update?.sql).toMatch(
			/WHERE\s+id\s*=\s*\?\s+AND\s+\(format\s*!=\s*\?\s+OR\s+sync_type\s*!=\s*\?\)/i
		)
	})

	it("re-extracts plain text from the detected format into lyrics_text_search", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" }],
			null,
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		const update = db.calls.find((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(update?.sql).toMatch(/lyrics_text_search\s*=\s*to_tsvector\('simple',\s*\?\)/i)
		const plainTextParam = update?.params[2] as string
		expect(plainTextParam).toContain("Hello")
		expect(plainTextParam).toContain("world")
		expect(plainTextParam).not.toContain("<span")
		expect(plainTextParam).not.toContain("begin=")
	})

	it("invalidates the v: cache key for each updated row only", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "vid_a", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" },
				{ id: 2, video_id: "vid_b", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" },
			],
			null,
			[],
		])
		const cache = makeMockCache({ "v:vid_a": "stale", "v:vid_b": "stale" })
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		expect(cache.deleteCalls).toContain("v:vid_a")
		expect(cache.deleteCalls).not.toContain("v:vid_b")
	})

	it("clears feed:global:* exactly once at the end when any row was changed", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" }],
			null,
			[],
		])
		const cache = makeMockCache({
			"feed:global:20": "stale",
			"feed:global:50": "stale",
			unrelated: "keep",
		})
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		expect(cache.keysCalls.filter((p) => p === "feed:global:*")).toHaveLength(1)
		expect(cache.deleteCalls).toContain("feed:global:20")
		expect(cache.deleteCalls).toContain("feed:global:50")
		expect(cache.deleteCalls).not.toContain("unrelated")
	})

	it("does not purge feed:global:* when nothing changed", async () => {
		const db = makeMockDB([
			[{ id: 1, video_id: "v1", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" }],
			[],
		])
		const cache = makeMockCache({ "feed:global:20": "keep" })
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.changed).toBe(0)
		expect(cache.deleteCalls).not.toContain("feed:global:20")
	})

	it("paginates by id cursor and terminates on a short final batch", async () => {
		const db = makeMockDB([
			[
				{ id: 5, video_id: "v5", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" },
				{ id: 9, video_id: "v9", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" },
			],
			[{ id: 12, video_id: "v12", format: "ttml", lyrics: RICHSYNC_TTML, sync_type: "richsync" }],
			[],
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		const selects = db.calls.filter((c) => /SELECT\b.*FROM\s+lyrics/i.test(c.sql))
		expect(selects).toHaveLength(3)
		expect(selects[0].params[0]).toBe(0)
		expect(selects[1].params[0]).toBe(9)
		expect(selects[2].params[0]).toBe(12)
	})

	it("advances the cursor and continues scanning when a row throws mid-loop", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "v_boom", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" },
				{ id: 2, video_id: "v_ok", format: "plain", lyrics: RICHSYNC_TTML, sync_type: "plain" },
			],
			null,
			null,
			[],
		])
		const cache = makeMockCache()
		cache.delete = async (key: string) => {
			if (key === "v:v_boom") throw new Error("cache outage")
		}
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.scanned).toBe(2)
		const selects = db.calls.filter((c) => /SELECT\b.*FROM\s+lyrics/i.test(c.sql))
		expect(selects).toHaveLength(2)
		expect(selects[1].params[0]).toBe(2)
		const updates = db.calls.filter((c) => /UPDATE\s+lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
	})

	it("filters out soft-deleted rows in the SELECT", async () => {
		const db = makeMockDB([[]])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		await backfillFormatDetection(env)

		const select = db.calls.find((c) => /SELECT\b.*FROM\s+lyrics/i.test(c.sql))
		expect(select?.sql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})

	it("terminates immediately when the first batch returns no rows", async () => {
		const db = makeMockDB([[]])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillFormatDetection(env)

		expect(result.scanned).toBe(0)
		expect(result.changed).toBe(0)
		const selects = db.calls.filter((c) => /SELECT\b.*FROM\s+lyrics/i.test(c.sql))
		expect(selects).toHaveLength(1)
	})
})
