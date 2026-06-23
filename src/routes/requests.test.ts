import { describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID, config } from "@/config"
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
		DUMP_DATABASE_URL: null,
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

const BOT_SECRET = "butler-bot-secret-value"

function envWithBotSecret(db: ReturnType<typeof makeMockDB>): Env {
	const env = makeEnv(db)
	env.BUTLER_BOT_SECRET = BOT_SECRET
	return env
}

function botRequest(body: unknown, secret: string | null = BOT_SECRET): Request {
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (secret !== null) headers.authorization = `Bearer ${secret}`
	return new Request("http://localhost/requests/bot", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	})
}

function lyricsRequestInsert(db: ReturnType<typeof makeMockDB>): DBCall | undefined {
	return db.calls.find((c) => c.sql.includes("INSERT INTO lyrics_requests"))
}

describe("POST /requests/bot", () => {
	it("attributes a linked request to the keyId at the user's reputation weight", async () => {
		const keyId = "a".repeat(64)
		const db = makeMockDB([
			{ id: 7, key_id: keyId, reputation: 1.4 }, // getUserByKeyId
			null, // hasServableSyncedVariant -> none
			null, // requested_songs upsert
			{ id: 100 }, // lyrics_requests insert RETURNING
			{ demand: 1.4, request_count: 1 }, // videoDemand
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({
				videoId: "vid1",
				song: "Song",
				artist: "Artist",
				thumbnailUrl: "https://x/t.jpg",
				keyId,
			})
		)

		expect(res.status).toBe(201)
		expect(await res.json()).toEqual({
			success: true,
			data: { status: "created", demand: 1.4, requestCount: 1 },
		})

		const insert = lyricsRequestInsert(db)
		expect(insert?.params).toEqual(["vid1", keyId, "extension", 1.4, expect.any(Number)])
	})

	it("rejects a request attributed to a blacklisted key", async () => {
		const db = makeMockDB([])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({ videoId: "vid1", song: "Song", artist: "Artist", keyId: COMMUNITY_KEY_ID })
		)

		expect(res.status).toBe(403)
		expect(lyricsRequestInsert(db)).toBeUndefined()
	})

	it("submits an unlinked request at the neutral weight keyed by requesterId", async () => {
		const db = makeMockDB([
			null, // hasServableSyncedVariant -> none
			null, // requested_songs upsert
			{ id: 101 }, // lyrics_requests insert RETURNING
			{ demand: 1, request_count: 1 }, // videoDemand
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({
				videoId: "vid2",
				song: "Song",
				artist: "Artist",
				requesterId: "discord-user-123",
			})
		)

		expect(res.status).toBe(201)
		const insert = lyricsRequestInsert(db)
		expect(insert?.params).toEqual([
			"vid2",
			"discord-user-123",
			"discord",
			config.requests.discordNeutralWeight,
			expect.any(Number),
		])
	})

	it("falls back to the neutral weight when the linked user has no row yet", async () => {
		const keyId = "b".repeat(64)
		const db = makeMockDB([
			null, // getUserByKeyId -> not found
			null, // hasServableSyncedVariant
			null, // requested_songs upsert
			{ id: 102 }, // insert
			{ demand: 1, request_count: 1 }, // demand
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({ videoId: "vid3", song: "Song", artist: "Artist", keyId })
		)

		expect(res.status).toBe(201)
		expect(lyricsRequestInsert(db)?.params[3]).toBe(config.requests.discordNeutralWeight)
	})

	it("resolves a discordId to its linked key and attributes at that reputation", async () => {
		const keyId = "d".repeat(64)
		const db = makeMockDB([
			{ discord_id: "disc-1", key_id: keyId }, // getByDiscordId
			{ id: 9, key_id: keyId, reputation: 1.7 }, // getUserByKeyId
			null, // hasServableSyncedVariant
			null, // requested_songs upsert
			{ id: 200 }, // lyrics_requests insert
			{ demand: 1.7, request_count: 1 }, // videoDemand
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({ videoId: "vid5", song: "Song", artist: "Artist", discordId: "disc-1" })
		)

		expect(res.status).toBe(201)
		const insert = lyricsRequestInsert(db)
		expect(insert?.params).toEqual(["vid5", keyId, "extension", 1.7, expect.any(Number)])
	})

	it("submits at neutral weight keyed by discordId when that Discord user is unlinked", async () => {
		const db = makeMockDB([
			null, // getByDiscordId -> not linked
			null, // hasServableSyncedVariant
			null, // requested_songs upsert
			{ id: 201 }, // lyrics_requests insert
			{ demand: 1, request_count: 1 }, // videoDemand
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({ videoId: "vid6", song: "Song", artist: "Artist", discordId: "disc-2" })
		)

		expect(res.status).toBe(201)
		const insert = lyricsRequestInsert(db)
		expect(insert?.params).toEqual([
			"vid6",
			"disc-2",
			"discord",
			config.requests.discordNeutralWeight,
			expect.any(Number),
		])
	})

	it("passes through already_available without creating a request", async () => {
		const db = makeMockDB([
			null, // getUserByKeyId
			{ ok: 1 }, // hasServableSyncedVariant -> synced exists
		])
		const env = envWithBotSecret(db)
		const app = requestRoutes(env)

		const res = await app.handle(
			botRequest({ videoId: "vid4", song: "Song", artist: "Artist", keyId: "c".repeat(64) })
		)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { status: "already_available" } })
		expect(lyricsRequestInsert(db)).toBeUndefined()
	})

	describe("auth", () => {
		it("rejects a missing bot secret with 401", async () => {
			const db = makeMockDB([])
			const env = envWithBotSecret(db)
			const app = requestRoutes(env)

			const res = await app.handle(
				botRequest({ videoId: "v", song: "S", artist: "A", requesterId: "d" }, null)
			)
			expect(res.status).toBe(401)
		})

		it("rejects a wrong bot secret with 401", async () => {
			const db = makeMockDB([])
			const env = envWithBotSecret(db)
			const app = requestRoutes(env)

			const res = await app.handle(
				botRequest({ videoId: "v", song: "S", artist: "A", requesterId: "d" }, "wrong-secret")
			)
			expect(res.status).toBe(401)
		})

		it("rejects when no bot secret is configured on the server with 401", async () => {
			const db = makeMockDB([])
			const env = makeEnv(db) // no BUTLER_BOT_SECRET
			const app = requestRoutes(env)

			const res = await app.handle(
				botRequest({ videoId: "v", song: "S", artist: "A", requesterId: "d" }, "anything")
			)
			expect(res.status).toBe(401)
		})
	})

	describe("validation", () => {
		it("rejects a request missing the videoId with 400", async () => {
			const db = makeMockDB([])
			const env = envWithBotSecret(db)
			const app = requestRoutes(env)

			const res = await app.handle(
				botRequest({ videoId: "", song: "S", artist: "A", requesterId: "d" })
			)
			expect(res.status).toBe(400)
		})

		it("rejects a request with neither keyId nor requesterId with 400", async () => {
			const db = makeMockDB([])
			const env = envWithBotSecret(db)
			const app = requestRoutes(env)

			const res = await app.handle(botRequest({ videoId: "v", song: "S", artist: "A" }))
			expect(res.status).toBe(400)
		})

		it("rejects an over-long song name with 400", async () => {
			const db = makeMockDB([])
			const env = envWithBotSecret(db)
			const app = requestRoutes(env)

			const res = await app.handle(
				botRequest({
					videoId: "v",
					song: "x".repeat(config.validation.song.maxLength + 1),
					artist: "A",
					requesterId: "d",
				})
			)
			expect(res.status).toBe(400)
		})
	})
})
