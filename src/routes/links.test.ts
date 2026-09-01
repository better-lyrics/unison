import { describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID } from "@/config"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import type { Env } from "@/types"
import { linkRoutes, linkStartRoutes } from "./links"

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
						getSql: () => sql,
						getParams: () => args,
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
		async batch(stmts: Array<{ getSql(): string; getParams(): unknown[] }>): Promise<void> {
			for (const stmt of stmts) {
				calls.push({ sql: stmt.getSql(), params: stmt.getParams() })
			}
		},
	}
	return db
}

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map(Object.entries(seed))
	const puts: { key: string; value: string }[] = []
	return {
		store,
		puts,
		async get(k: string) {
			return store.get(k) ?? null
		},
		async put(k: string, v: string) {
			store.set(k, v)
			puts.push({ key: k, value: v })
		},
		async delete(k: string) {
			store.delete(k)
		},
		async getDel(k: string) {
			const v = store.get(k) ?? null
			store.delete(k)
			return v
		},
		async setNX() {
			return true
		},
		async keys() {
			return []
		},
	}
}

const OAUTH = {
	clientId: "client-1",
	clientSecret: "secret-1",
	redirectUri: "https://unison.boidu.dev/links/discord/callback",
}

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache>,
	overrides: Partial<Env> = {}
): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {
			async limit() {
				return { success: true }
			},
		} as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		DISCORD_OAUTH: OAUTH,
		...overrides,
	}
}

async function generateKeyPair() {
	return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
}

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>

async function signedStartBody(keyId: string, kp: GeneratedKeyPair, publicJwk: JsonWebKey) {
	const payload = { timestamp: Date.now(), nonce: "n".repeat(32), keyId }
	const buf = new TextEncoder().encode(canonicalJson(payload))
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, buf)
	const bytes = new Uint8Array(sig)
	let bin = ""
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
	return { payload, signature: btoa(bin), publicKey: publicJwk }
}

function okJson(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	})
}

function discordFetch(user: {
	id: string
	username: string
	global_name?: string | null
}): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input)
		if (url.endsWith("/oauth2/token")) return okJson({ access_token: "tok" })
		if (url.endsWith("/users/@me")) return okJson(user)
		return new Response(null, { status: 404 })
	}) as typeof fetch
}

describe("POST /links/discord/start", () => {
	it("returns a Discord authorize URL and stores single-use state bound to the key", async () => {
		const kp = await generateKeyPair()
		const publicJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 }, // getPublicKey
			{ id: 7, key_id: keyId }, // getOrCreateUser
		])
		const cache = makeMockCache()
		const app = linkStartRoutes(makeEnv(db, cache))

		const res = await app.handle(
			new Request("http://localhost/links/discord/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(await signedStartBody(keyId, kp, publicJwk)),
			})
		)

		expect(res.status).toBe(200)
		const json = (await res.json()) as { data: { authorizeUrl: string } }
		const url = new URL(json.data.authorizeUrl)
		expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize")
		const state = url.searchParams.get("state")
		expect(state).toBeTruthy()
		expect(cache.store.get(`link_state:${state}`)).toBe(keyId)
	})

	it("refuses to start a link for a blacklisted key", async () => {
		const kp = await generateKeyPair()
		const publicJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey
		// Force the signed identity to be the community key by registering it under that id.
		const db = makeMockDB([
			{ key_id: COMMUNITY_KEY_ID, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 1, key_id: COMMUNITY_KEY_ID },
		])
		const cache = makeMockCache()
		const app = linkStartRoutes(makeEnv(db, cache))

		const body = await signedStartBody(COMMUNITY_KEY_ID, kp, publicJwk)
		const res = await app.handle(
			new Request("http://localhost/links/discord/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)
		expect(res.status).toBe(403)
	})

	it("reports 503 when Discord OAuth is not configured", async () => {
		const kp = await generateKeyPair()
		const publicJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey
		const keyId = await hashPublicKey(publicJwk)
		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 7, key_id: keyId },
		])
		const cache = makeMockCache()
		const app = linkStartRoutes(makeEnv(db, cache, { DISCORD_OAUTH: null }))

		const res = await app.handle(
			new Request("http://localhost/links/discord/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(await signedStartBody(keyId, kp, publicJwk)),
			})
		)
		expect(res.status).toBe(503)
	})
})

describe("GET /links/discord/callback", () => {
	const KEY = "a".repeat(64)

	it("links the account and redirects to the success page", async () => {
		const cache = makeMockCache({ "link_state:st-1": KEY })
		const db = makeMockDB([null, null]) // linkDiscord: delete, insert
		const app = linkRoutes(
			makeEnv(db, cache),
			discordFetch({ id: "d-1", username: "alice", global_name: "Alice" })
		)

		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c-1&state=st-1", {
				redirect: "manual",
			})
		)

		expect(res.status).toBe(302)
		const loc = res.headers.get("location") ?? ""
		expect(loc).toContain("/link?status=linked")
		expect(loc).toContain("name=Alice")
		const insert = db.calls.find((c) => c.sql.includes("INSERT INTO discord_links"))
		expect(insert?.params).toEqual(["d-1", KEY, "Alice", expect.any(Number)])
		// state is single-use
		expect(cache.store.has("link_state:st-1")).toBe(false)
	})

	it("redirects to expired when the state is unknown", async () => {
		const cache = makeMockCache()
		const app = linkRoutes(makeEnv(makeMockDB(), cache), discordFetch({ id: "d", username: "x" }))
		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c&state=missing", {
				redirect: "manual",
			})
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("status=expired")
	})

	it("redirects to blocked when the key is blacklisted", async () => {
		const cache = makeMockCache({ "link_state:st-2": COMMUNITY_KEY_ID })
		const app = linkRoutes(makeEnv(makeMockDB(), cache), discordFetch({ id: "d", username: "x" }))
		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c&state=st-2", {
				redirect: "manual",
			})
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("status=blocked")
	})

	it("redirects to error when Discord exchange fails", async () => {
		const cache = makeMockCache({ "link_state:st-3": KEY })
		const failing = (async (input: string | URL | Request) => {
			if (String(input).endsWith("/oauth2/token")) return new Response(null, { status: 400 })
			return new Response(null, { status: 404 })
		}) as typeof fetch
		const app = linkRoutes(makeEnv(makeMockDB(), cache), failing)
		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=bad&state=st-3", {
				redirect: "manual",
			})
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("status=error")
	})

	it("redirects to error when params are missing", async () => {
		const app = linkRoutes(
			makeEnv(makeMockDB(), makeMockCache()),
			discordFetch({ id: "d", username: "x" })
		)
		const res = await app.handle(
			new Request("http://localhost/links/discord/callback", { redirect: "manual" })
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("status=error")
	})
})

describe("GET /links/discord/callback - migration attach", () => {
	const oldKey = "a".repeat(64)
	const newKey = "b".repeat(64)

	function seedActiveSession(cache: ReturnType<typeof makeMockCache>) {
		const session = {
			sessionId: "msess",
			discordId: "d-1",
			oldKey,
			newKey: null,
			status: "awaiting_new_key",
			nicknameKept: true,
			counts: null,
			migrationId: null,
			createdAt: 1,
		}
		cache.store.set("migration:msess", JSON.stringify(session))
		cache.store.set("migration:by-discord:d-1", "msess")
	}

	it("treats a link from a discord with an active migration session as the proof, and does NOT relink", async () => {
		const cache = makeMockCache({ "link_state:st-m": newKey })
		seedActiveSession(cache)
		// computeMigrationPlan (relabel: old user, no new user, req collisions) + createPreviewAudit
		const db = makeMockDB([{ id: 1 }, null, { n: 0 }, { id: 99 }])
		const app = linkRoutes(
			makeEnv(db, cache),
			discordFetch({ id: "d-1", username: "alice", global_name: "Alice" })
		)

		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c&state=st-m", { redirect: "manual" })
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("/migrate?status=ready")
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO discord_links"))).toBe(false)
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO migration_requests"))).toBe(true)

		const updated = JSON.parse(cache.store.get("migration:msess") ?? "{}")
		expect(updated.status).toBe("ready")
		expect(updated.newKey).toBe(newKey)
		expect(updated.migrationId).toBe(99)
		expect(updated.counts).toEqual({
			submissions: 0,
			votes: 0,
			reports: 0,
			fulfillments: 0,
			collisions: 0,
		})
	})

	it("fails the session with same_key when the proven key equals the old key", async () => {
		const cache = makeMockCache({ "link_state:st-s": oldKey })
		seedActiveSession(cache)
		const db = makeMockDB([])
		const app = linkRoutes(makeEnv(db, cache), discordFetch({ id: "d-1", username: "a" }))

		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c&state=st-s", { redirect: "manual" })
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("/migrate?status=same_key")
		const updated = JSON.parse(cache.store.get("migration:msess") ?? "{}")
		expect(updated.status).toBe("failed")
		expect(updated.failureReason).toBe("same_key")
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO discord_links"))).toBe(false)
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO migration_requests"))).toBe(false)
	})

	it("performs a normal relink when the discord has no active migration session", async () => {
		const cache = makeMockCache({ "link_state:st-n": newKey })
		const db = makeMockDB([null, null]) // linkDiscord: delete, insert
		const app = linkRoutes(
			makeEnv(db, cache),
			discordFetch({ id: "d-2", username: "bob", global_name: "Bob" })
		)

		const res = await app.handle(
			new Request("http://localhost/links/discord/callback?code=c&state=st-n", { redirect: "manual" })
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("/link?status=linked")
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO discord_links"))).toBe(true)
		expect(db.calls.some((c) => c.sql.includes("INSERT INTO migration_requests"))).toBe(false)
	})
})

describe("bot read endpoints", () => {
	it("returns all links to an authorized bot", async () => {
		const rows = [{ discord_id: "d1", key_id: "k1" }]
		const db = makeMockDB([rows])
		const app = linkRoutes(makeEnv(db, makeMockCache(), { BUTLER_BOT_SECRET: "bot-secret" }))
		const res = await app.handle(
			new Request("http://localhost/links/bot/all", {
				headers: { authorization: "Bearer bot-secret" },
			})
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { links: rows } })
	})

	it("rejects an unauthorized bot request", async () => {
		const app = linkRoutes(
			makeEnv(makeMockDB(), makeMockCache(), { BUTLER_BOT_SECRET: "bot-secret" })
		)
		const res = await app.handle(
			new Request("http://localhost/links/bot/all", {
				headers: { authorization: "Bearer wrong" },
			})
		)
		expect(res.status).toBe(401)
	})

	it("returns the blacklist to an authorized bot", async () => {
		const app = linkRoutes(
			makeEnv(makeMockDB(), makeMockCache(), { BUTLER_BOT_SECRET: "bot-secret" })
		)
		const res = await app.handle(
			new Request("http://localhost/links/bot/blacklist", {
				headers: { authorization: "Bearer bot-secret" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { data: { keyIds: string[] } }
		expect(json.data.keyIds).toContain(COMMUNITY_KEY_ID)
	})
})

describe("GET /links/me and DELETE /links/discord", () => {
	const KEY = "a".repeat(64)
	const TOKEN = "session-token"

	function sessionEnv(db: ReturnType<typeof makeMockDB>) {
		const cache = makeMockCache({
			[`session:${TOKEN}`]: JSON.stringify({ keyId: KEY, issuedAt: 0, expiresAt: 9_999_999_999 }),
		})
		return makeEnv(db, cache)
	}

	it("reports linked status for the signed-in user", async () => {
		const db = makeMockDB([
			{ id: 7, key_id: KEY }, // getOrCreateUser (eitherAuth)
			{ discord_id: "d-1", key_id: KEY, discord_username: "alice", linked_at: 1 }, // getByKeyId
		])
		const app = linkRoutes(sessionEnv(db))
		const res = await app.handle(
			new Request("http://localhost/links/me", { headers: { authorization: `Bearer ${TOKEN}` } })
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			success: true,
			data: { linked: true, discordId: "d-1", discordUsername: "alice" },
		})
	})

	it("reports not-linked when there is no link", async () => {
		const db = makeMockDB([
			{ id: 7, key_id: KEY }, // getOrCreateUser
			null, // getByKeyId -> none
		])
		const app = linkRoutes(sessionEnv(db))
		const res = await app.handle(
			new Request("http://localhost/links/me", { headers: { authorization: `Bearer ${TOKEN}` } })
		)
		expect(res.status).toBe(200)
		expect(((await res.json()) as { data: { linked: boolean } }).data.linked).toBe(false)
	})

	it("unlinks the signed-in user", async () => {
		const db = makeMockDB([
			{ id: 7, key_id: KEY }, // getOrCreateUser
			null, // unlinkByKeyId delete
		])
		const app = linkRoutes(sessionEnv(db))
		const res = await app.handle(
			new Request("http://localhost/links/discord", {
				method: "DELETE",
				headers: { authorization: `Bearer ${TOKEN}` },
			})
		)
		expect(res.status).toBe(200)
		const del = db.calls.find((c) => c.sql.includes("DELETE FROM discord_links"))
		expect(del?.params).toEqual([KEY])
	})
})
