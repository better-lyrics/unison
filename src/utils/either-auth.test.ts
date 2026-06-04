import { Elysia } from "elysia"
import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "./crypto"
import { eitherAuth } from "./either-auth"

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
		.use(eitherAuth)
		.post("/act", ({ keyId, userId, body }) => ({
			success: true,
			data: { keyId, userId, body },
		}))
}

function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store[`session:${token}`] = JSON.stringify({
		keyId,
		issuedAt,
		expiresAt: issuedAt + 60,
	})
}

async function generateKeyPair() {
	return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])
}

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>

async function exportPublicJwk(keyPair: GeneratedKeyPair): Promise<JsonWebKey> {
	const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
	return jwk as unknown as JsonWebKey
}

async function signPayload(
	payload: object,
	privateKey: GeneratedKeyPair["privateKey"]
): Promise<string> {
	const buf = new TextEncoder().encode(canonicalJson(payload))
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buf)
	const bytes = new Uint8Array(sig)
	let bin = ""
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
	return btoa(bin)
}

describe("eitherAuth middleware: bearer path", () => {
	it("normalizes body to ctx.body and exposes keyId/userId on a valid bearer", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok-good", keyId)
		const db = makeMockDB([{ id: 7, key_id: keyId }])
		const env = makeEnv(db, cache)
		const app = makeApp(env)

		const res = await app.handle(
			new Request("http://localhost/act", {
				method: "POST",
				headers: {
					authorization: "Bearer tok-good",
					"content-type": "application/json",
				},
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			data: { keyId: string; userId: number; body: Record<string, unknown> }
		}
		expect(body.data.keyId).toBe(keyId)
		expect(body.data.userId).toBe(7)
		expect(body.data.body).toEqual({ vote: 1 })
	})

	it("returns 401 AUTH_REQUIRED when the bearer is invalid", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/act", {
				method: "POST",
				headers: {
					authorization: "Bearer unknown",
					"content-type": "application/json",
				},
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(401)
		const body = (await res.json()) as { code: string }
		expect(body.code).toBe("AUTH_REQUIRED")
	})
})

describe("eitherAuth middleware: signed-envelope path", () => {
	it("lifts action fields out of signedPayload into ctx.body on a valid envelope", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 11, key_id: keyId },
		])
		const env = makeEnv(db, makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			vote: 1,
			details: "looks fine",
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/act", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			data: { keyId: string; userId: number; body: Record<string, unknown> }
		}
		expect(body.data.keyId).toBe(keyId)
		expect(body.data.userId).toBe(11)
		expect(body.data.body).toEqual({ vote: 1, details: "looks fine" })
	})

	it("returns 400 INVALID_SIGNED_BODY when the envelope is malformed and no bearer", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)
		const res = await app.handle(
			new Request("http://localhost/act", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ not: "valid" }),
			})
		)
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string }
		expect(body.code).toBe("INVALID_SIGNED_BODY")
	})
})

describe("eitherAuth middleware: bearer takes precedence", () => {
	it("uses the bearer path when both a bearer header and a signed envelope are present", async () => {
		const bearerKeyId = "b".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok-b", bearerKeyId)
		const db = makeMockDB([{ id: 5, key_id: bearerKeyId }])
		const env = makeEnv(db, cache)
		const app = makeApp(env)

		const otherPayload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId: "c".repeat(64),
			vote: -1,
		}
		const res = await app.handle(
			new Request("http://localhost/act", {
				method: "POST",
				headers: {
					authorization: "Bearer tok-b",
					"content-type": "application/json",
				},
				body: JSON.stringify({ payload: otherPayload, signature: "ignored" }),
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			data: { keyId: string; userId: number; body: Record<string, unknown> }
		}
		expect(body.data.keyId).toBe(bearerKeyId)
		expect(body.data.userId).toBe(5)
		expect(body.data.body).toEqual({ payload: otherPayload, signature: "ignored" })
	})
})
