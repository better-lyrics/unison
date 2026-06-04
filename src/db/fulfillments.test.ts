import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { recordFulfillment } from "./fulfillments"

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

function makeEnv(db: ReturnType<typeof makeMockDB>): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const cache = {
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

describe("recordFulfillment", () => {
	it("skips when a servable synced variant already existed pre-insert", async () => {
		const db = makeMockDB([{ "1": 1 }])
		const env = makeEnv(db)

		const result = await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		expect(result.recorded).toBe(false)
		if (!result.recorded) {
			expect(result.reason).toBe("already_fulfilled")
		}
	})

	it("skips when in-window demand is zero (no live requests)", async () => {
		const db = makeMockDB([null, { demand: 0, request_count: 0 }])
		const env = makeEnv(db)

		const result = await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		expect(result.recorded).toBe(false)
		if (!result.recorded) {
			expect(result.reason).toBe("no_live_demand")
		}
	})

	it("writes the fulfillment row and sweeps lyrics_requests on success", async () => {
		const db = makeMockDB([null, { demand: 5.0, request_count: 3 }, { id: 100 }, null])
		const env = makeEnv(db)

		const result = await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		expect(result.recorded).toBe(true)
		const sqls = db.calls.map((c) => c.sql).join("\n")
		expect(sqls).toMatch(/INSERT INTO request_fulfillments/i)
		expect(sqls).toMatch(/DELETE FROM lyrics_requests/i)
	})

	it("excludes self-requests from the snapshot query", async () => {
		const db = makeMockDB([null, { demand: 0, request_count: 0 }])
		const env = makeEnv(db)

		await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		const snapshotCall = db.calls.find((c) => c.sql.includes("SUM(weight)"))
		expect(snapshotCall).toBeDefined()
		expect(snapshotCall?.sql).toMatch(/requester_id\s*!=\s*\?/)
		expect(snapshotCall?.params).toContain("k7")
	})

	it("pre-state check excludes the just-inserted lyrics_id", async () => {
		const db = makeMockDB([null, { demand: 0, request_count: 0 }])
		const env = makeEnv(db)

		await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		const preCheck = db.calls[0]
		expect(preCheck.sql).toMatch(/id\s*!=\s*\?/)
		expect(preCheck.params).toContain(42)
	})

	it("inserts with demand and count snapshots bound from the snapshot query", async () => {
		const db = makeMockDB([null, { demand: 9.5, request_count: 7 }, { id: 100 }, null])
		const env = makeEnv(db)

		await recordFulfillment(env, {
			videoId: "v1",
			lyricsId: 42,
			submitterId: 7,
			submitterKeyId: "k7",
		})

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO request_fulfillments"))
		expect(insertCall?.params).toEqual(expect.arrayContaining(["v1", 42, 7, 9.5, 7]))
	})
})
