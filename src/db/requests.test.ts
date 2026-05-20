import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { createRequest } from "./requests"

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

describe("createRequest", () => {
	it("returns already_available when a servable synced variant exists", async () => {
		const db = makeMockDB([{ "1": 1 }])
		const env = makeEnv(db)
		const result = await createRequest(env, {
			videoId: "v1",
			song: "S",
			artist: "A",
			thumbnailUrl: null,
			requesterId: "k1",
			requesterType: "extension",
			weight: 1.0,
		})
		expect(result.status).toBe("already_available")
	})

	it("returns created with demand when the request is newly inserted", async () => {
		const db = makeMockDB([
			null,
			null,
			{ id: 10 },
			{ demand: 2.5, request_count: 3 },
		])
		const env = makeEnv(db)
		const result = await createRequest(env, {
			videoId: "v1",
			song: "S",
			artist: "A",
			thumbnailUrl: null,
			requesterId: "k1",
			requesterType: "extension",
			weight: 1.0,
		})
		expect(result).toEqual({ status: "created", demand: 2.5, requestCount: 3 })
	})

	it("returns already_requested when the unique constraint blocks the insert", async () => {
		const db = makeMockDB([
			null,
			null,
			null,
			{ demand: 1.0, request_count: 1 },
		])
		const env = makeEnv(db)
		const result = await createRequest(env, {
			videoId: "v1",
			song: "S",
			artist: "A",
			thumbnailUrl: null,
			requesterId: "k1",
			requesterType: "extension",
			weight: 1.0,
		})
		expect(result.status).toBe("already_requested")
	})
})
