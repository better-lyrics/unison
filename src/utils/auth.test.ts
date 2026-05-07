import { Elysia } from "elysia"
import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "./crypto"
import { signedRequest } from "./auth"

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

function makeMockCache(opts: { nonceClaimable?: boolean } = {}) {
	const claimable = opts.nonceClaimable ?? true
	const setNXCalls: string[] = []
	return {
		setNXCalls,
		async get() {
			return null
		},
		async put() {},
		async delete() {},
		async keys() {
			return []
		},
		async setNX(key: string) {
			setNXCalls.push(key)
			return claimable
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
	}
}

function makeApp(env: Env) {
	return new Elysia()
		.decorate("env", env)
		.use(signedRequest)
		.post("/test", ({ keyId, userId }) => ({ success: true, data: { keyId, userId } }))
}

async function generateKeyPair() {
	return await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"]
	)
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

function makeRequest(body: unknown): Request {
	return new Request("http://localhost/test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}

async function readJson(res: Response): Promise<{ success: boolean; error?: string }> {
	const text = await res.text()
	return JSON.parse(text) as { success: boolean; error?: string }
}

describe("signedRequest middleware: error responses", () => {
	it("returns 400 INVALID_SIGNED_BODY when body shape is wrong", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)

		const res = await app.handle(makeRequest({ not: "valid" }))
		const body = await readJson(res)

		expect(res.status).toBe(400)
		expect(body).toEqual({ success: false, error: "INVALID_SIGNED_BODY" })
	})

	it("returns 401 TIMESTAMP_EXPIRED when payload timestamp is stale", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now() - 10 * 60 * 1000,
			nonce: "n".repeat(32),
			keyId: "a".repeat(64),
		}
		const res = await app.handle(makeRequest({ payload, signature: "x" }))
		const body = await readJson(res)

		expect(res.status).toBe(401)
		expect(body).toEqual({ success: false, error: "TIMESTAMP_EXPIRED" })
	})

	it("returns 409 NONCE_REPLAY when setNX fails to claim the nonce", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache({ nonceClaimable: false }))
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId: "a".repeat(64),
		}
		const res = await app.handle(makeRequest({ payload, signature: "x" }))
		const body = await readJson(res)

		expect(res.status).toBe(409)
		expect(body).toEqual({ success: false, error: "NONCE_REPLAY" })
	})

	it("returns 400 PUBLIC_KEY_REQUIRED when keyId is unknown and no publicKey is sent", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db, makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId: "a".repeat(64),
		}
		const res = await app.handle(makeRequest({ payload, signature: "x" }))
		const body = await readJson(res)

		expect(res.status).toBe(400)
		expect(body).toEqual({ success: false, error: "PUBLIC_KEY_REQUIRED" })
	})

	it("returns 403 KEY_ID_MISMATCH when publicKey does not hash to keyId", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)

		const db = makeMockDB([null])
		const env = makeEnv(db, makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId: "f".repeat(64),
		}
		const res = await app.handle(
			makeRequest({ payload, signature: "x", publicKey: publicJwk })
		)
		const body = await readJson(res)

		expect(res.status).toBe(403)
		expect(body).toEqual({ success: false, error: "KEY_ID_MISMATCH" })
	})

	it("returns 401 INVALID_SIGNATURE when stored key cannot verify the signature", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
		])
		const env = makeEnv(db, makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
		}
		const res = await app.handle(
			makeRequest({
				payload,
				signature: "AAAA",
			})
		)
		const body = await readJson(res)

		expect(res.status).toBe(401)
		expect(body).toEqual({ success: false, error: "INVALID_SIGNATURE" })
	})

	it("authenticates a valid signed request and exposes keyId/userId to handler", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 7, key_id: keyId },
		])
		const env = makeEnv(db, makeMockCache())
		const app = makeApp(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(makeRequest({ payload, signature }))
		const body = await readJson(res)

		expect(res.status).toBe(200)
		expect(body).toEqual({ success: true, data: { keyId, userId: 7 } })
	})
})
