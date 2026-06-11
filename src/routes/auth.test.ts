import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { generatePetName } from "@/utils/petname"
import { authRoutes } from "./auth"

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map<string, { value: string; ttl: number }>()
	for (const [k, v] of Object.entries(seed)) store.set(k, { value: v, ttl: 0 })
	const setNXKeys: string[] = []
	const getDelCalls: string[] = []
	const deleteCalls: string[] = []
	return {
		store,
		setNXKeys,
		getDelCalls,
		deleteCalls,
		async get(key: string) {
			return store.get(key)?.value ?? null
		},
		async put(key: string, value: string, opts?: { expirationTtl?: number }) {
			store.set(key, { value, ttl: opts?.expirationTtl ?? 0 })
		},
		async delete(key: string) {
			deleteCalls.push(key)
			store.delete(key)
		},
		async getDel(key: string) {
			getDelCalls.push(key)
			const entry = store.get(key)
			if (!entry) return null
			store.delete(key)
			return entry.value
		},
		async keys() {
			return Array.from(store.keys())
		},
		async setNX(key: string, _value: string, _ttl: number) {
			setNXKeys.push(key)
			if (store.has(key)) return false
			store.set(key, { value: _value, ttl: _ttl })
			return true
		},
	}
}

function makeEnv(cache: ReturnType<typeof makeMockCache>): Env & {
	cache: ReturnType<typeof makeMockCache>
} {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: {} as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		cache,
	}
}

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
							const next = queue.shift()
							if (
								next instanceof Error ||
								(next && typeof next === "object" && "code" in next)
							) {
								throw next
							}
						},
					}
				},
			}
		},
	}
	return db
}

function makeEnvFull(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache>
): Env & { cache: ReturnType<typeof makeMockCache> } {
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
		cache,
	}
}

async function makeIdentity() {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])
	const publicKey = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey
	const keyId = await hashPublicKey(publicKey)
	return { pair, publicKey, keyId }
}

type GeneratedIdentity = Awaited<ReturnType<typeof makeIdentity>>

async function signPayload(
	privKey: GeneratedIdentity["pair"]["privateKey"],
	payload: object
): Promise<string> {
	const data = new TextEncoder().encode(canonicalJson(payload))
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privKey, data)
	const bytes = new Uint8Array(sig)
	let bin = ""
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin)
}

describe("GET /auth/challenge", () => {
	it("returns a fresh nonce and stores it with the challenge TTL", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const res = await app.handle(new Request("http://localhost/auth/challenge"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { nonce: string; expiresAt: number }
		}
		expect(json.success).toBe(true)
		expect(json.data.nonce).toHaveLength(32)
		const entry = cache.store.get(`challenge:${json.data.nonce}`)
		expect(entry).toBeDefined()
		expect(entry!.ttl).toBe(5 * 60)
		const nowSec = Math.floor(Date.now() / 1000)
		expect(json.data.expiresAt).toBeGreaterThanOrEqual(nowSec + 5 * 60 - 2)
		expect(json.data.expiresAt).toBeLessThanOrEqual(nowSec + 5 * 60 + 2)
	})

	it("produces unique nonces across calls", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const nonces = new Set<string>()
		for (let i = 0; i < 5; i++) {
			const res = await app.handle(new Request("http://localhost/auth/challenge"))
			const json = (await res.json()) as { data: { nonce: string } }
			nonces.add(json.data.nonce)
		}
		expect(nonces.size).toBe(5)
	})
})

describe("POST /auth/session", () => {
	const validNonce = "nonce-".padEnd(24, "x")

	async function buildBody(opts: {
		nonce: string
		origin: string
		timestamp?: number
	}) {
		const { pair, publicKey, keyId } = await makeIdentity()
		const payload = {
			nonce: opts.nonce,
			origin: opts.origin,
			keyId,
			timestamp: opts.timestamp ?? Date.now(),
		}
		const signature = await signPayload(pair.privateKey, payload)
		return { keyId, publicKey, body: { payload, signature, publicKey } }
	}

	function registrationQueue(keyId: string, publicKey: JsonWebKey): unknown[] {
		return [
			null,
			null,
			{ key_id: keyId, public_key: JSON.stringify(publicKey), created_at: 0 },
			null,
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		]
	}

	it("issues a session token on a fresh, well-formed assertion", async () => {
		const cache = makeMockCache({ [`challenge:${validNonce}`]: "1" })
		const { keyId, publicKey, body } = await buildBody({
			nonce: validNonce,
			origin: "https://example.com",
		})
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://example.com" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { sessionToken: string; keyId: string; displayName: string; expiresAt: number }
		}
		expect(json.success).toBe(true)
		expect(json.data.sessionToken.length).toBeGreaterThanOrEqual(32)
		expect(json.data.displayName.length).toBeGreaterThan(0)
		expect(json.data.keyId).toBe(keyId)
		expect(cache.store.has(`challenge:${validNonce}`)).toBe(false)
		expect(cache.getDelCalls).toEqual([`challenge:${validNonce}`])
		expect(cache.deleteCalls).toEqual([])
	})

	it("consumes the challenge atomically so a replay returns CHALLENGE_INVALID", async () => {
		const cache = makeMockCache({ [`challenge:${validNonce}`]: "1" })
		const first = await buildBody({ nonce: validNonce, origin: "https://example.com" })
		const second = await buildBody({ nonce: validNonce, origin: "https://example.com" })
		const db = makeMockDB([
			...registrationQueue(first.keyId, first.publicKey),
			{ nickname: null },
			...registrationQueue(second.keyId, second.publicKey),
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const firstRes = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://example.com" },
				body: JSON.stringify(first.body),
			})
		)
		expect(firstRes.status).toBe(200)
		const secondRes = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://example.com" },
				body: JSON.stringify(second.body),
			})
		)
		expect(secondRes.status).toBe(401)
		const json = (await secondRes.json()) as { error: string }
		expect(json.error).toBe("CHALLENGE_INVALID")
		expect(cache.getDelCalls).toHaveLength(2)
	})

	it("rejects when the signed origin does not match the request Origin header", async () => {
		const cache = makeMockCache({ [`challenge:${validNonce}`]: "1" })
		const { keyId, publicKey, body } = await buildBody({
			nonce: validNonce,
			origin: "https://example.com",
		})
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://attacker.example" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(403)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("ORIGIN_MISMATCH")
		expect(cache.store.has(`challenge:${validNonce}`)).toBe(true)
	})

	it("rejects when the challenge nonce was never issued or already consumed", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({
			nonce: validNonce,
			origin: "https://example.com",
		})
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://example.com" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { error: string }
		expect(json.error).toBe("CHALLENGE_INVALID")
	})

	it("rejects when the Origin header is missing", async () => {
		const cache = makeMockCache({ [`challenge:${validNonce}`]: "1" })
		const { keyId, publicKey, body } = await buildBody({
			nonce: validNonce,
			origin: "https://example.com",
		})
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(403)
		const json = (await res.json()) as { error: string }
		expect(json.error).toBe("ORIGIN_MISMATCH")
	})

	it("/session reflects a custom nickname when users.nickname is set", async () => {
		const cache = makeMockCache({ [`challenge:${validNonce}`]: "1" })
		const { keyId, publicKey, body } = await buildBody({
			nonce: validNonce,
			origin: "https://example.com",
		})
		const db = makeMockDB([...registrationQueue(keyId, publicKey), { nickname: "Brook" }])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/session", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://example.com" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { sessionToken: string; keyId: string; displayName: string; expiresAt: number }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe("Brook")
	})
})

describe("POST /auth/logout", () => {
	it("deletes the session for a valid bearer token", async () => {
		const cache = makeMockCache()
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set("session:tok-good", {
			value: JSON.stringify({ keyId: "k".repeat(64), issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/logout", {
				method: "POST",
				headers: { authorization: "Bearer tok-good" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { success: boolean; data: { revoked: boolean } }
		expect(json.success).toBe(true)
		expect(json.data.revoked).toBe(true)
		expect(cache.store.has("session:tok-good")).toBe(false)
		expect(cache.deleteCalls).toContain("session:tok-good")
	})

	it("returns success even when the token is unknown so it does not leak validity", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/logout", {
				method: "POST",
				headers: { authorization: "Bearer tok-missing" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { success: boolean; data: { revoked: boolean } }
		expect(json.success).toBe(true)
		expect(json.data.revoked).toBe(true)
		expect(cache.deleteCalls).toContain("session:tok-missing")
	})

	it("returns 401 when no Authorization header is sent", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const res = await app.handle(new Request("http://localhost/auth/logout", { method: "POST" }))
		expect(res.status).toBe(401)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("MISSING_TOKEN")
		expect(cache.deleteCalls).toEqual([])
	})
})

describe("GET /auth/me", () => {
	it("returns the identity bound to a valid bearer token", async () => {
		const cache = makeMockCache()
		const keyId = "d".repeat(64)
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set("session:tok-good", {
			value: JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
		const db = makeMockDB([{ nickname: null }])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/me", {
				headers: { authorization: "Bearer tok-good" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { keyId: string; displayName: string; expiresAt: number }
		}
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName.length).toBeGreaterThan(0)
		expect(json.data.expiresAt).toBe(issuedAt + ttl)
	})

	it("returns 401 when no Authorization header is sent", async () => {
		const env = makeEnv(makeMockCache())
		const app = authRoutes(env)
		const res = await app.handle(new Request("http://localhost/auth/me"))
		expect(res.status).toBe(401)
	})

	it("returns 401 when the token is unknown", async () => {
		const env = makeEnv(makeMockCache())
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/me", {
				headers: { authorization: "Bearer missing" },
			})
		)
		expect(res.status).toBe(401)
	})

	it("/me reflects a custom nickname when users.nickname is set", async () => {
		const cache = makeMockCache()
		const keyId = "e".repeat(64)
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set("session:tok-nick", {
			value: JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
		const db = makeMockDB([{ nickname: "Alex" }])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/me", {
				headers: { authorization: "Bearer tok-nick" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { keyId: string; displayName: string; expiresAt: number }
		}
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe("Alex")
	})
})

describe("POST /auth/nickname/check", () => {
	function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set(`session:${token}`, {
			value: JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
	}

	async function buildSignedBody(opts: { nickname: unknown; timestamp?: number }) {
		const { pair, publicKey, keyId } = await makeIdentity()
		const nonce = "chk-".padEnd(24, "x")
		const payload = {
			nonce,
			keyId,
			nickname: opts.nickname,
			timestamp: opts.timestamp ?? Date.now(),
		}
		const signature = await signPayload(pair.privateKey, payload)
		return { keyId, publicKey, body: { payload, signature, publicKey } }
	}

	function registrationQueue(keyId: string, publicKey: JsonWebKey): unknown[] {
		return [
			null,
			null,
			{ key_id: keyId, public_key: JSON.stringify(publicKey), created_at: 0 },
			null,
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		]
	}

	it("bearer path: 401 AUTH_REQUIRED when bearer is unknown", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer nope", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "alex" }),
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})

	it("bearer path: 200 INVALID_FORMAT for too short", async () => {
		const cache = makeMockCache()
		seedSession(cache, "tok", "a".repeat(64))
		const db = makeMockDB([
			{ id: 1, key_id: "a".repeat(64), reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "ab" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.data.available).toBe(false)
		expect(json.data.reason).toBe("INVALID_FORMAT")
	})

	it("bearer path: 200 INVALID_FORMAT for spaces", async () => {
		const cache = makeMockCache()
		seedSession(cache, "tok", "a".repeat(64))
		const db = makeMockDB([
			{ id: 1, key_id: "a".repeat(64), reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "a b" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.data.available).toBe(false)
		expect(json.data.reason).toBe("INVALID_FORMAT")
	})

	it("bearer path: 200 available:true for unused name", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			null,
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "alex" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.data.available).toBe(true)
		expect(json.data.reason).toBeUndefined()
		const lookupCall = db.calls.find((c) => c.sql.includes("nickname_lower"))
		expect(lookupCall?.params).toEqual(["alex"])
	})

	it("bearer path: 200 TAKEN when another user holds it case-insensitively", async () => {
		const callerKeyId = "a".repeat(64)
		const ownerKeyId = "b".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", callerKeyId)
		const db = makeMockDB([
			{ id: 1, key_id: callerKeyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			{ key_id: ownerKeyId },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "Alex" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.data.available).toBe(false)
		expect(json.data.reason).toBe("TAKEN")
		const lookupCall = db.calls.find((c) => c.sql.includes("nickname_lower"))
		expect(lookupCall?.params).toEqual(["alex"])
	})

	it("bearer path: 200 SELF when caller holds it", async () => {
		const callerKeyId = "c".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", callerKeyId)
		const db = makeMockDB([
			{ id: 1, key_id: callerKeyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			{ key_id: callerKeyId },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "Alex" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.data.available).toBe(true)
		expect(json.data.reason).toBe("SELF")
	})

	it("bearer path: 429 when budget exhausted", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		])
		const limiter = {
			async limit(opts: { key: string }) {
				if (opts.key.startsWith("nickname_check:")) return { success: false }
				return { success: true }
			},
		}
		const env: Env & { cache: ReturnType<typeof makeMockCache> } = {
			DB: db as unknown as Env["DB"],
			CACHE: cache as unknown as Env["CACHE"],
			RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
			READ_RATE_LIMITER: {
				async limit() {
					return { success: true }
				},
			} as unknown as Env["READ_RATE_LIMITER"],
			CACHE_TTL_SECONDS: "300",
			DUMPS_ENABLED: false,
			DUMP_PUBLIC_BASE_URL: "",
			DUMP_DATABASE_URL: null,
			B2: null,
			cache,
		}
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "alex" }),
			})
		)
		expect(res.status).toBe(429)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("RATE_LIMITED")
	})

	it("signed path: rejects unsigned bodies with 400 INVALID_SIGNED_BODY", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ nickname: "alex" }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_SIGNED_BODY")
	})

	it("signed path: 200 available:true for unused name via signed envelope", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildSignedBody({ nickname: "Alex" })
		const db = makeMockDB([...registrationQueue(keyId, publicKey), null])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/check", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: true
			data: { available: boolean; reason?: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.available).toBe(true)
		expect(json.data.reason).toBeUndefined()
		const lookupCall = db.calls.find((c) => c.sql.includes("nickname_lower"))
		expect(lookupCall?.params).toEqual(["alex"])
	})
})

describe("PUT /auth/nickname", () => {
	async function buildBody(opts: { nickname: unknown; timestamp?: number }) {
		const { pair, publicKey, keyId } = await makeIdentity()
		const nonce = "nick-".padEnd(24, "x")
		const payload = {
			nonce,
			keyId,
			nickname: opts.nickname,
			timestamp: opts.timestamp ?? Date.now(),
		}
		const signature = await signPayload(pair.privateKey, payload)
		return { keyId, publicKey, body: { payload, signature, publicKey } }
	}

	function registrationQueue(keyId: string, publicKey: JsonWebKey): unknown[] {
		return [
			null,
			null,
			{ key_id: keyId, public_key: JSON.stringify(publicKey), created_at: 0 },
			null,
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		]
	}

	it("rejects unsigned requests with 400 INVALID_SIGNED_BODY", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ nickname: "Alex" }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_SIGNED_BODY")
	})

	it("400 INVALID_FORMAT when nickname violates the regex", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({ nickname: "a b" })
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("INVALID_FORMAT")
	})

	it("200 round-trip: PUT returns the new displayName", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({ nickname: "Alex" })
		const db = makeMockDB([
			...registrationQueue(keyId, publicKey),
			null,
			{ nickname: "Alex" },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe("Alex")
	})

	it("409 NICKNAME_TAKEN when another user holds it (case-insensitive)", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({ nickname: "alex" })
		const db = makeMockDB([
			...registrationQueue(keyId, publicKey),
			{ code: "23505" },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(409)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("NICKNAME_TAKEN")
	})

	it("200 when the same user re-submits their own nickname", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({ nickname: "Alex" })
		const db = makeMockDB([
			...registrationQueue(keyId, publicKey),
			null,
			{ nickname: "Alex" },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.displayName).toBe("Alex")
	})

	it("429 RATE_LIMITED when the write bucket is exhausted", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody({ nickname: "Alex" })
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const limiter = {
			async limit(opts: { key: string }) {
				if (opts.key.startsWith("nickname_write:")) return { success: false }
				return { success: true }
			},
		}
		const env: Env & { cache: ReturnType<typeof makeMockCache> } = {
			DB: db as unknown as Env["DB"],
			CACHE: cache as unknown as Env["CACHE"],
			RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
			READ_RATE_LIMITER: {
				async limit() {
					return { success: true }
				},
			} as unknown as Env["READ_RATE_LIMITER"],
			CACHE_TTL_SECONDS: "300",
			DUMPS_ENABLED: false,
			DUMP_PUBLIC_BASE_URL: "",
			DUMP_DATABASE_URL: null,
			B2: null,
			cache,
		}
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(429)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("RATE_LIMITED")
	})
})

describe("DELETE /auth/nickname", () => {
	async function buildBody(opts: { timestamp?: number } = {}) {
		const { pair, publicKey, keyId } = await makeIdentity()
		const nonce = "del-".padEnd(24, "x")
		const payload = {
			nonce,
			keyId,
			timestamp: opts.timestamp ?? Date.now(),
		}
		const signature = await signPayload(pair.privateKey, payload)
		return { keyId, publicKey, body: { payload, signature, publicKey } }
	}

	function registrationQueue(keyId: string, publicKey: JsonWebKey): unknown[] {
		return [
			null,
			null,
			{ key_id: keyId, public_key: JSON.stringify(publicKey), created_at: 0 },
			null,
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		]
	}

	it("clears the nickname and returns the generated fallback", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody()
		const db = makeMockDB([
			...registrationQueue(keyId, publicKey),
			null,
			{ nickname: null },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe(generatePetName(keyId))
	})

	it("rejects unsigned requests with 400 INVALID_SIGNED_BODY", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_SIGNED_BODY")
	})

	it("429 RATE_LIMITED when the write bucket is exhausted", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody()
		const db = makeMockDB(registrationQueue(keyId, publicKey))
		const limiter = {
			async limit(opts: { key: string }) {
				if (opts.key.startsWith("nickname_write:")) return { success: false }
				return { success: true }
			},
		}
		const env: Env & { cache: ReturnType<typeof makeMockCache> } = {
			DB: db as unknown as Env["DB"],
			CACHE: cache as unknown as Env["CACHE"],
			RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
			READ_RATE_LIMITER: {
				async limit() {
					return { success: true }
				},
			} as unknown as Env["READ_RATE_LIMITER"],
			CACHE_TTL_SECONDS: "300",
			DUMPS_ENABLED: false,
			DUMP_PUBLIC_BASE_URL: "",
			DUMP_DATABASE_URL: null,
			B2: null,
			cache,
		}
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(429)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("RATE_LIMITED")
	})
})

describe("POST /auth/nickname/me", () => {
	async function buildBody(opts: { timestamp?: number } = {}) {
		const { pair, publicKey, keyId } = await makeIdentity()
		const nonce = "me--".padEnd(24, "x")
		const payload = {
			nonce,
			keyId,
			timestamp: opts.timestamp ?? Date.now(),
		}
		const signature = await signPayload(pair.privateKey, payload)
		return { keyId, publicKey, body: { payload, signature, publicKey } }
	}

	function registrationQueue(keyId: string, publicKey: JsonWebKey): unknown[] {
		return [
			null,
			null,
			{ key_id: keyId, public_key: JSON.stringify(publicKey), created_at: 0 },
			null,
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		]
	}

	it("returns the generated fallback when no nickname is set", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody()
		const db = makeMockDB([...registrationQueue(keyId, publicKey), { nickname: null }])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/me", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe(generatePetName(keyId))
	})

	it("returns the custom nickname when set", async () => {
		const cache = makeMockCache()
		const { keyId, publicKey, body } = await buildBody()
		const db = makeMockDB([...registrationQueue(keyId, publicKey), { nickname: "Alex" }])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/me", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.displayName).toBe("Alex")
	})

	it("rejects unsigned requests with 400 INVALID_SIGNED_BODY", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname/me", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_SIGNED_BODY")
	})
})

describe("PUT /auth/nickname bearer path", () => {
	function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set(`session:${token}`, {
			value: JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
	}

	it("PUT bearer path: casts a nickname update via bearer token", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			null,
			{ nickname: "Alex" },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "Alex" }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe("Alex")
	})

	it("PUT bearer path: 400 INVALID_FORMAT on bad regex via bearer", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "a b" }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("INVALID_FORMAT")
	})

	it("PUT bearer path: 401 AUTH_REQUIRED when bearer token is unknown", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { authorization: "Bearer nope", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "Alex" }),
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})

	it("PUT bearer path: 409 NICKNAME_TAKEN on collision via bearer", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			{ code: "23505" },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ nickname: "alex" }),
			})
		)
		expect(res.status).toBe(409)
		const json = (await res.json()) as { success: boolean; error: string }
		expect(json.success).toBe(false)
		expect(json.error).toBe("NICKNAME_TAKEN")
	})
})

describe("DELETE /auth/nickname bearer path", () => {
	function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
		const ttl = 30 * 24 * 60 * 60
		const issuedAt = Math.floor(Date.now() / 1000)
		cache.store.set(`session:${token}`, {
			value: JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + ttl }),
			ttl,
		})
	}

	it("DELETE bearer path: clears nickname via bearer token", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 1, key_id: keyId, reputation: 1.0, vote_count: 0, avg_vote: 0, created_at: 0 },
			null,
			{ nickname: null },
		])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { keyId: string; displayName: string }
		}
		expect(json.success).toBe(true)
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.displayName).toBe(generatePetName(keyId))
	})

	it("DELETE bearer path: 401 AUTH_REQUIRED when bearer token is unknown", async () => {
		const cache = makeMockCache()
		const db = makeMockDB([])
		const env = makeEnvFull(db, cache)
		const app = authRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/auth/nickname", {
				method: "DELETE",
				headers: { authorization: "Bearer nope" },
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})
})
