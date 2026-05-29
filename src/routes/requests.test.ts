import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { requestRoutes } from "./requests"

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
		B2: null,
	}
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

describe("POST /requests", () => {
	it("creates a request and returns demand", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 }, // getPublicKey
			{ id: 7, key_id: keyId }, // getOrCreateUser
			{ id: 7, key_id: keyId, reputation: 1.4 }, // getUserById (weight lookup)
			null, // hasServableSyncedVariant -> none
			null, // requested_songs upsert
			{ id: 100 }, // lyrics_requests insert RETURNING
			{ demand: 1.4, request_count: 1 }, // videoDemand
		])
		const env = makeEnv(db)
		const app = requestRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			videoId: "vid1",
			song: "Song",
			artist: "Artist",
			thumbnailUrl: "https://x/t.jpg",
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/requests", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)

		expect(res.status).toBe(201)
		const json = await res.json()
		expect(json).toEqual({
			success: true,
			data: { status: "created", demand: 1.4, requestCount: 1 },
		})
	})

	it("rejects a payload missing videoId with 400", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 }, // getPublicKey
			{ id: 7, key_id: keyId }, // getOrCreateUser
		])
		const env = makeEnv(db)
		const app = requestRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			videoId: "",
			song: "Song",
			artist: "Artist",
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/requests", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)

		expect(res.status).toBe(400)
	})

	it("rejects a payload whose song name is too long with 400", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 }, // getPublicKey
			{ id: 7, key_id: keyId }, // getOrCreateUser
		])
		const env = makeEnv(db)
		const app = requestRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			videoId: "vid1",
			song: "x".repeat(501),
			artist: "Artist",
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/requests", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)

		expect(res.status).toBe(400)
	})
})
