import { Elysia } from "elysia"
import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { sessionAuth } from "./session-auth"

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

function makeMockCache(seed: Record<string, string> = {}) {
	const store: Record<string, string> = { ...seed }
	return {
		store,
		async get(key: string) {
			return store[key] ?? null
		},
		async put(key: string, value: string) {
			store[key] = value
		},
		async delete(key: string) {
			delete store[key]
		},
		async keys() {
			return Object.keys(store)
		},
		async setNX(key: string, value: string) {
			if (store[key] !== undefined) return false
			store[key] = value
			return true
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>, cache: ReturnType<typeof makeMockCache>): Env {
	const limiter = {
		async limit() {
			return { success: true }
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

function makeApp(env: Env) {
	return new Elysia()
		.decorate("env", env)
		.use(sessionAuth)
		.get("/protected", ({ keyId, userId }) => ({ success: true, data: { keyId, userId } }))
}

function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store[`session:${token}`] = JSON.stringify({
		keyId,
		issuedAt,
		expiresAt: issuedAt + 60,
	})
}

describe("sessionAuth middleware", () => {
	it("resolves keyId and userId for a valid bearer token", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok-good", keyId)
		const db = makeMockDB([{ id: 42, key_id: keyId }])
		const env = makeEnv(db, cache)
		const app = makeApp(env)

		const res = await app.handle(
			new Request("http://localhost/protected", {
				headers: { authorization: "Bearer tok-good" },
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { success: boolean; data: { keyId: string; userId: number } }
		expect(body.data.keyId).toBe(keyId)
		expect(body.data.userId).toBe(42)
	})

	it("returns 401 AUTH_REQUIRED when the Authorization header is missing", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(new Request("http://localhost/protected"))
		expect(res.status).toBe(401)
		const body = (await res.json()) as { success: boolean; error: string; code: string }
		expect(body.success).toBe(false)
		expect(body.code).toBe("AUTH_REQUIRED")
	})

	it("returns 401 AUTH_REQUIRED when the header lacks a Bearer prefix", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/protected", { headers: { authorization: "Basic xyz" } })
		)
		expect(res.status).toBe(401)
	})

	it("returns 401 AUTH_REQUIRED when the bearer token is empty", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/protected", { headers: { authorization: "Bearer " } })
		)
		expect(res.status).toBe(401)
	})

	it("returns 401 AUTH_REQUIRED when the session lookup misses", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/protected", {
				headers: { authorization: "Bearer unknown-tok" },
			})
		)
		expect(res.status).toBe(401)
		const body = (await res.json()) as { error: string; code: string }
		expect(body.code).toBe("AUTH_REQUIRED")
	})

	it("creates the user when the session exists but the user record is new", async () => {
		const keyId = "b".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok-new", keyId)
		const db = makeMockDB([null, { id: 99, key_id: keyId }])
		const env = makeEnv(db, cache)
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/protected", {
				headers: { authorization: "Bearer tok-new" },
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { data: { keyId: string; userId: number } }
		expect(body.data.userId).toBe(99)
		expect(body.data.keyId).toBe(keyId)
	})
})
