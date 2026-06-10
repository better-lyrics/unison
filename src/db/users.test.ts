import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { generatePetName } from "@/utils/petname"
import { resolveDisplayName } from "./users"

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

describe("resolveDisplayName", () => {
	it("returns the stored nickname when the user has set one", async () => {
		const db = makeMockDB([{ nickname: "Alex" }])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, "k1")
		expect(result).toBe("Alex")
		expect(db.calls[0].sql).toBe("SELECT nickname FROM users WHERE key_id = ?")
		expect(db.calls[0].params).toEqual(["k1"])
	})

	it("falls back to generatePetName when nickname is null", async () => {
		const keyId = "abcdef0123456789"
		const db = makeMockDB([{ nickname: null }])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, keyId)
		expect(result).toBe(generatePetName(keyId))
		expect(db.calls[0].params).toEqual([keyId])
	})

	it("falls back to generatePetName when no row exists", async () => {
		const keyId = "0011223344556677"
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, keyId)
		expect(result).toBe(generatePetName(keyId))
		expect(db.calls[0].params).toEqual([keyId])
	})
})
