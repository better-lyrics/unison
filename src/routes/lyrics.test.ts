import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { lyricsRoutes } from "./lyrics"

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

describe("GET /lyrics duration query parsing", () => {
	it("rounds fractional duration before binding to integer SQL column", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const res = await app.handle(
			new Request(
				"http://localhost/lyrics?song=Foo&artist=Bar&duration=29.917460140589583"
			)
		)

		expect(res.status).toBe(404)
		const findCall = db.calls.find((c) => /ABS\(l\.duration - \?\)/.test(c.sql))
		expect(findCall).toBeDefined()
		const durationParam = findCall?.params[2]
		expect(durationParam).toBe(30)
		expect(Number.isInteger(durationParam)).toBe(true)
	})

	it("omits duration filter when value is not finite", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const res = await app.handle(
			new Request("http://localhost/lyrics?song=Foo&artist=Bar&duration=notanumber")
		)

		expect(res.status).toBe(404)
		const findCall = db.calls.find((c) => /song_norm/.test(c.sql))
		expect(findCall?.sql).not.toContain("ABS(l.duration")
	})

	it("passes integer duration through unchanged", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		await app.handle(
			new Request("http://localhost/lyrics?song=Foo&artist=Bar&duration=200")
		)

		const findCall = db.calls.find((c) => /ABS\(l\.duration - \?\)/.test(c.sql))
		expect(findCall?.params[2]).toBe(200)
	})
})

describe("GET /lyrics/search duration query parsing", () => {
	it("rounds fractional duration before binding to integer SQL column", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const res = await app.handle(
			new Request(
				"http://localhost/lyrics/search?song=Foo&artist=Bar&duration=29.917460140589583"
			)
		)

		expect(res.status).toBe(200)
		const findCall = db.calls.find((c) => /ABS\(l\.duration - \?\)/.test(c.sql))
		expect(findCall).toBeDefined()
		expect(findCall?.params[2]).toBe(30)
	})
})
