import { config } from "@/config"
import { createBoost, getQuota, revokeBoost } from "@/db/boost"
import { isCommittee } from "@/db/committee"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { describe, expect, it, vi } from "vitest"
import { voteRoutes } from "./votes"

vi.mock("@/jobs/score-updater", () => ({
	recalculateScore: vi.fn(() => Promise.resolve()),
}))
vi.mock("@/db/users", async () => {
	const actual = await vi.importActual<typeof import("@/db/users")>("@/db/users")
	return {
		...actual,
		updateUserAvgVote: vi.fn(() => Promise.resolve()),
	}
})
vi.mock("@/db/boost", () => ({
	createBoost: vi.fn(),
	revokeBoost: vi.fn(),
	getQuota: vi.fn(),
}))
vi.mock("@/db/committee", () => ({
	isCommittee: vi.fn(),
}))

interface DBCall {
	sql: string
	params: unknown[]
}

class MockStatement {
	private params: unknown[] = []
	constructor(
		readonly sql: string,
		private readonly db: MockDB
	) {}
	bind(...args: unknown[]): MockStatement {
		this.params = args
		return this
	}
	async first<T>(): Promise<T | null> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		return (this.db.queue.shift() as T) ?? null
	}
	async all<T>(): Promise<{ results: T[] }> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		return { results: (this.db.queue.shift() as T[]) ?? [] }
	}
	async run(): Promise<void> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		this.db.queue.shift()
	}
	getSql() {
		return this.sql
	}
	getParams() {
		return this.params
	}
}

interface MockDB {
	calls: DBCall[]
	queue: unknown[]
	prepare(sql: string): MockStatement
	batch(stmts: MockStatement[]): Promise<void>
}

function makeMockDB(queue: unknown[] = []): MockDB {
	const calls: DBCall[] = []
	const db: MockDB = {
		calls,
		queue,
		prepare(sql: string) {
			return new MockStatement(sql, db)
		},
		async batch(stmts: MockStatement[]) {
			for (const stmt of stmts) {
				calls.push({ sql: stmt.getSql(), params: stmt.getParams() })
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

function makeEnv(db: MockDB, cache: ReturnType<typeof makeMockCache>): Env {
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

function seedSession(cache: ReturnType<typeof makeMockCache>, token: string, keyId: string) {
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store[`session:${token}`] = JSON.stringify({
		keyId,
		issuedAt,
		expiresAt: issuedAt + 600,
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

const LYRICS_ROW = {
	id: 7,
	video_id: "vid7",
	song: "Song",
	artist: "Artist",
	album: null,
	isrc: null,
	duration: 200,
	format: "lrc",
	language: null,
	sync_type: "linesync",
	lyrics: "plain",
	score: 0,
	effective_score: 0,
	vote_count: 0,
	upvotes: 0,
	downvotes: 0,
	confidence: "low",
	submitter_id: null,
	deleted_at: null,
	created_at: 0,
	updated_at: 0,
}

describe("POST /lyrics/:id/vote bearer path", () => {
	it("casts a vote using the user resolved from the bearer", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const userId = 42
		const db = makeMockDB([
			{ id: userId, key_id: keyId },
			LYRICS_ROW,
			{ submitter_id: 99, video_id: "vid7", deleted_at: null },
			null,
			null,
			null,
		])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)

		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { success: boolean; data: { message: string } }
		expect(json.success).toBe(true)
		expect(json.data.message).toBe("Vote recorded")
		const insert = db.calls.find((c) => /INSERT INTO votes/.test(c.sql))
		expect(insert?.params[1]).toBe(userId)
	})

	it("falls through to the signed path and returns 400 INVALID_SIGNED_BODY when no auth is provided", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_SIGNED_BODY")
	})

	it("returns 401 AUTH_REQUIRED when the bearer token is unknown", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer nope", "content-type": "application/json" },
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})

	it("returns 400 INVALID_VOTE when vote is not 1 or -1", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([{ id: 1, key_id: keyId }, LYRICS_ROW])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ vote: 2 }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_VOTE")
	})

	it("returns 400 INVALID_VOTE when vote is missing", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([{ id: 1, key_id: keyId }, LYRICS_ROW])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({}),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_VOTE")
	})
})

describe("DELETE /lyrics/:id/vote bearer path", () => {
	it("removes an existing vote for the bearer user", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 11, key_id: keyId },
			LYRICS_ROW,
			{ vote: 1, video_id: "vid7" },
			null,
			null,
		])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { success: boolean }
		expect(json.success).toBe(true)
	})

	it("returns 401 AUTH_REQUIRED when neither auth nor body is provided", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", { method: "DELETE" })
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})

	it("returns 401 AUTH_REQUIRED when the bearer token is unknown", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "DELETE",
				headers: { authorization: "Bearer nope" },
			})
		)
		expect(res.status).toBe(401)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("AUTH_REQUIRED")
	})
})

describe("POST /lyrics/:id/report bearer path", () => {
	it("records a report when the reason is valid", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 13, key_id: keyId },
			LYRICS_ROW,
			{ deleted_at: null },
			null,
			null,
			{ count: 1 },
		])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/report", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ reason: "spam" }),
			})
		)
		expect(res.status).toBe(201)
		const json = (await res.json()) as { success: boolean; data: { message: string } }
		expect(json.success).toBe(true)
		const insert = db.calls.find((c) => /INSERT INTO reports/.test(c.sql))
		expect(insert?.params[2]).toBe("spam")
	})

	it("rejects an unknown reason with 400 INVALID_REPORT_REASON", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([{ id: 14, key_id: keyId }, LYRICS_ROW])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/report", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ reason: "unknown_reason" }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("INVALID_REPORT_REASON")
	})

	it("rejects oversized details with 400 REPORT_DETAILS_TOO_LONG", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([{ id: 15, key_id: keyId }, LYRICS_ROW])
		const env = makeEnv(db, cache)
		const app = voteRoutes(env)
		const oversize = "x".repeat(config.validation.report.maxDetailsLength + 1)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/report", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ reason: "spam", details: oversize }),
			})
		)
		expect(res.status).toBe(400)
		const json = (await res.json()) as { code: string }
		expect(json.code).toBe("REPORT_DETAILS_TOO_LONG")
	})
})

describe("signed-envelope path regression", () => {
	it("casts a vote when the request is a valid signed envelope", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 21, key_id: keyId },
			LYRICS_ROW,
			{ submitter_id: 99, video_id: "vid7", deleted_at: null },
			null,
			null,
			null,
		])
		const env = makeEnv(db, makeMockCache())
		const app = voteRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			vote: 1,
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { success: boolean }
		expect(json.success).toBe(true)
	})

	it("removes a vote when the request is a valid signed envelope", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 22, key_id: keyId },
			LYRICS_ROW,
			{ vote: 1, video_id: "vid7" },
			null,
			null,
		])
		const env = makeEnv(db, makeMockCache())
		const app = voteRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)
		expect(res.status).toBe(200)
	})

	it("records a report when the request is a valid signed envelope", async () => {
		const keyPair = await generateKeyPair()
		const publicJwk = await exportPublicJwk(keyPair)
		const keyId = await hashPublicKey(publicJwk)

		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 23, key_id: keyId },
			LYRICS_ROW,
			{ deleted_at: null },
			null,
			null,
			{ count: 1 },
		])
		const env = makeEnv(db, makeMockCache())
		const app = voteRoutes(env)

		const payload = {
			timestamp: Date.now(),
			nonce: "n".repeat(32),
			keyId,
			reason: "spam",
		}
		const signature = await signPayload(payload, keyPair.privateKey)
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/report", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)
		expect(res.status).toBe(201)
		const json = (await res.json()) as { success: boolean }
		expect(json.success).toBe(true)
	})
})

const BOOST_QUOTA = { quota: 2, used: 1, remaining: 1, resetsAt: 4102444800 }

function seedBoostAuth(userId = 7): { env: Env; app: ReturnType<typeof voteRoutes> } {
	const keyId = "a".repeat(64)
	const cache = makeMockCache()
	seedSession(cache, "tok", keyId)
	const db = makeMockDB([{ id: userId, key_id: keyId }])
	const env = makeEnv(db, cache)
	return { env, app: voteRoutes(env) }
}

function boostReq(id: number, method: "POST" | "DELETE", headers: Record<string, string>) {
	return new Request(`http://localhost/lyrics/${id}/boost`, {
		method,
		headers: { "content-type": "application/json", ...headers },
		body: method === "POST" ? JSON.stringify({}) : undefined,
	})
}

describe("POST /lyrics/:id/boost", () => {
	it("returns 401 when the bearer token is unknown", async () => {
		const env = makeEnv(makeMockDB(), makeMockCache())
		const app = voteRoutes(env)
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer nope" }))
		expect(res.status).toBe(401)
		expect(((await res.json()) as { code: string }).code).toBe("AUTH_REQUIRED")
	})

	it("maps not_committee to 403 NOT_COMMITTEE", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(createBoost).mockResolvedValue({ ok: false, reason: "not_committee" })
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer tok" }))
		expect(res.status).toBe(403)
		expect(((await res.json()) as { code: string }).code).toBe("NOT_COMMITTEE")
	})

	it("echoes the fresh quota on success", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(createBoost).mockResolvedValue({ ok: true, quota: BOOST_QUOTA })
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer tok" }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, quota: BOOST_QUOTA })
	})

	it("maps over_quota to 429 BOOST_QUOTA_EXCEEDED", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(createBoost).mockResolvedValue({ ok: false, reason: "over_quota" })
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer tok" }))
		expect(res.status).toBe(429)
		expect(((await res.json()) as { code: string }).code).toBe("BOOST_QUOTA_EXCEEDED")
	})

	it("maps already_boosted to 409 BOOST_ALREADY_ACTIVE", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(createBoost).mockResolvedValue({ ok: false, reason: "already_boosted" })
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer tok" }))
		expect(res.status).toBe(409)
		expect(((await res.json()) as { code: string }).code).toBe("BOOST_ALREADY_ACTIVE")
	})

	it("rejects with 429 RATE_LIMITED before calling createBoost", async () => {
		const { env, app } = seedBoostAuth()
		env.RATE_LIMITER = {
			async limit() {
				return { success: false }
			},
		} as unknown as Env["RATE_LIMITER"]
		vi.mocked(createBoost).mockClear()
		const res = await app.handle(boostReq(5, "POST", { authorization: "Bearer tok" }))
		expect(res.status).toBe(429)
		expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED")
		expect(vi.mocked(createBoost)).not.toHaveBeenCalled()
	})
})

describe("DELETE /lyrics/:id/boost", () => {
	it("returns 403 NOT_COMMITTEE for a non-committee actor", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(isCommittee).mockResolvedValue(false)
		const res = await app.handle(boostReq(5, "DELETE", { authorization: "Bearer tok" }))
		expect(res.status).toBe(403)
		expect(((await res.json()) as { code: string }).code).toBe("NOT_COMMITTEE")
	})

	it("revokes an active boost for a committee actor", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(isCommittee).mockResolvedValue(true)
		vi.mocked(revokeBoost).mockResolvedValue({ ok: true })
		const res = await app.handle(boostReq(5, "DELETE", { authorization: "Bearer tok" }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
	})

	it("maps forbidden to 403 BOOST_NOT_OWNER", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(isCommittee).mockResolvedValue(true)
		vi.mocked(revokeBoost).mockResolvedValue({ ok: false, reason: "forbidden" })
		const res = await app.handle(boostReq(5, "DELETE", { authorization: "Bearer tok" }))
		expect(res.status).toBe(403)
		expect(((await res.json()) as { code: string }).code).toBe("BOOST_NOT_OWNER")
	})
})

describe("GET /lyrics/boost/quota", () => {
	function quotaReq() {
		return new Request("http://localhost/lyrics/boost/quota", {
			method: "GET",
			headers: { authorization: "Bearer tok" },
		})
	}

	it("returns 403 NOT_COMMITTEE for a non-committee caller", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(isCommittee).mockResolvedValue(false)
		const res = await app.handle(quotaReq())
		expect(res.status).toBe(403)
		expect(((await res.json()) as { code: string }).code).toBe("NOT_COMMITTEE")
	})

	it("returns the quota for a committee caller", async () => {
		const { app } = seedBoostAuth()
		vi.mocked(isCommittee).mockResolvedValue(true)
		vi.mocked(getQuota).mockResolvedValue(BOOST_QUOTA)
		const res = await app.handle(quotaReq())
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, quota: BOOST_QUOTA })
	})
})

describe("vote rate limiting", () => {
	function limitFailEnv(): { env: Env; app: ReturnType<typeof voteRoutes> } {
		const { env, app } = seedBoostAuth()
		env.RATE_LIMITER = {
			async limit() {
				return { success: false }
			},
		} as unknown as Env["RATE_LIMITER"]
		return { env, app }
	}

	it("casts a vote (200) when under the write rate limit", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const userId = 42
		const db = makeMockDB([
			{ id: userId, key_id: keyId },
			LYRICS_ROW,
			{ submitter_id: 99, video_id: "vid7", deleted_at: null },
			null,
			null,
			null,
		])
		const app = voteRoutes(makeEnv(db, cache))
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(200)
		expect(((await res.json()) as { success: boolean }).success).toBe(true)
	})

	it("rejects a cast with 429 RATE_LIMITED when the write limit is exceeded", async () => {
		const { app } = limitFailEnv()
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ vote: 1 }),
			})
		)
		expect(res.status).toBe(429)
		expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED")
	})

	it("removes a vote (200) when under the write rate limit", async () => {
		const keyId = "a".repeat(64)
		const cache = makeMockCache()
		seedSession(cache, "tok", keyId)
		const db = makeMockDB([
			{ id: 11, key_id: keyId },
			LYRICS_ROW,
			{ vote: 1, video_id: "vid7" },
			null,
			null,
		])
		const app = voteRoutes(makeEnv(db, cache))
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(200)
		expect(((await res.json()) as { success: boolean }).success).toBe(true)
	})

	it("rejects a remove with 429 RATE_LIMITED when the write limit is exceeded", async () => {
		const { app } = limitFailEnv()
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/vote", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(429)
		expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED")
	})
})
