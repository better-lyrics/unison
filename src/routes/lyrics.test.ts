import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
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
			new Request("http://localhost/lyrics?song=Foo&artist=Bar&duration=29.917460140589583")
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

		await app.handle(new Request("http://localhost/lyrics?song=Foo&artist=Bar&duration=200"))

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
			new Request("http://localhost/lyrics/search?song=Foo&artist=Bar&duration=29.917460140589583")
		)

		expect(res.status).toBe(200)
		const findCall = db.calls.find((c) => /ABS\(l\.duration - \?\)/.test(c.sql))
		expect(findCall).toBeDefined()
		expect(findCall?.params[2]).toBe(30)
	})
})

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

const RICHSYNC_TTML =
	'<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
	'<p begin="0:00.0" end="0:02.0">' +
	'<span begin="0:00.0" end="0:01.0">Hello</span> ' +
	'<span begin="0:01.0" end="0:02.0">world</span>' +
	"</p></div></body></tt>"

const PLAIN_LRC = "Just text\nNo timestamps"

async function buildSubmitRequest(
	keyPair: GeneratedKeyPair,
	keyId: string,
	body: Record<string, unknown>
): Promise<Request> {
	const payload = {
		timestamp: Date.now(),
		nonce: "n".repeat(32),
		keyId,
		...body,
	}
	const signature = await signPayload(payload, keyPair.privateKey)
	return new Request("http://localhost/lyrics/submit", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ payload, signature }),
	})
}

describe("POST /lyrics/submit syncType override", () => {
	it("overrides client-claimed linesync with detected richsync for word-timed TTML", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 }, // getPublicKey
			{ id: 7, key_id: keyId }, // getOrCreateUser
			{ count: 0 }, // variant cap check
			{ id: 99 }, // INSERT RETURNING id
		])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const req = await buildSubmitRequest(keyPair, keyId, {
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "ttml",
			syncType: "linesync",
		})

		const res = await app.handle(req)
		expect(res.status).toBe(201)

		const insertCall = db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))
		expect(insertCall).toBeDefined()
		const syncTypeIndex = 12
		expect(insertCall?.params[syncTypeIndex]).toBe("richsync")
	})

	it("uses detected plain when client omits syncType for plain LRC content", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 7, key_id: keyId },
			{ count: 0 },
			{ id: 99 },
		])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const req = await buildSubmitRequest(keyPair, keyId, {
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: PLAIN_LRC,
			format: "lrc",
		})

		const res = await app.handle(req)
		expect(res.status).toBe(201)

		const insertCall = db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))
		expect(insertCall?.params[12]).toBe("plain")
	})

	it("does not log a mismatch when client claim matches detection", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 7, key_id: keyId },
			{ count: 0 },
			{ id: 99 },
		])
		const env = makeEnv(db)
		const app = lyricsRoutes(env)

		const req = await buildSubmitRequest(keyPair, keyId, {
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "ttml",
			syncType: "richsync",
		})

		const res = await app.handle(req)
		expect(res.status).toBe(201)
		const insertCall = db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))
		expect(insertCall?.params[12]).toBe("richsync")
	})
})
