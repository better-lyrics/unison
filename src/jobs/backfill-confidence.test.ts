import { config } from "@/config"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { backfillConfidence } from "./backfill-confidence"

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
			const stmt = {
				bind(..._args: unknown[]) {
					return stmt
				},
				async first<T>(): Promise<T | null> {
					calls.push({ sql, params: [] })
					const next = queue.shift()
					return (next as T) ?? null
				},
				async all<T>(): Promise<{ results: T[] }> {
					calls.push({ sql, params: [] })
					const next = queue.shift()
					return { results: (next as T[]) ?? [] }
				},
				async run(): Promise<void> {
					calls.push({ sql, params: [] })
					queue.shift()
				},
			}
			return stmt
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

describe("backfillConfidence", () => {
	it("recomputes tiers and invalidates cache for each changed video", async () => {
		const db = makeMockDB([
			[
				{ id: 1, video_id: "vidA" },
				{ id: 2, video_id: "vidA" },
				{ id: 3, video_id: "vidB" },
			],
			undefined,
		])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillConfidence(env)

		expect(result.updated).toBe(3)
		expect(cache.deleteCalls.sort()).toEqual(["v:vidA", "v:vidB"])
		expect(db.calls.some((c) => /UPDATE\s+lyrics/i.test(c.sql))).toBe(true)
	})

	it("is idempotent: no changed rows means no UPDATE and no cache invalidation", async () => {
		const db = makeMockDB([[]])
		const cache = makeMockCache()
		const env = makeEnv(db, cache)

		const result = await backfillConfidence(env)

		expect(result.updated).toBe(0)
		expect(cache.deleteCalls).toEqual([])
		expect(db.calls.some((c) => /UPDATE\s+lyrics/i.test(c.sql))).toBe(false)
	})

	it("uses the configured confidence threshold and excludes deleted rows", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db, makeMockCache())
		await backfillConfidence(env)
		const selectSql = db.calls[0].sql
		expect(selectSql).toContain(`vote_count >= ${config.reputation.minVotesForConfidence}`)
		expect(selectSql).toContain("diversity_bonus = 1")
		expect(selectSql).toContain("deleted_at IS NULL")
	})

	it("gates medium/high tiers behind the configured score floor", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db, makeMockCache())
		await backfillConfidence(env)
		const selectSql = db.calls[0].sql
		expect(selectSql).toContain(`effective_score >= ${config.reputation.minScoreForConfidence}`)
	})
})
