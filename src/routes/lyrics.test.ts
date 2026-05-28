import type { Env, FeedItem } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { describe, expect, it } from "vitest"
import { lyricsRoutes } from "./lyrics"

const baseFeedItem: FeedItem = {
	id: 1,
	video_id: "v",
	song: "S",
	artist: "A",
	album: null,
	isrc: null,
	duration: 100,
	format: "lrc",
	language: null,
	sync_type: "linesync",
	score: 0,
	effective_score: 0,
	vote_count: 0,
	confidence: "low",
	created_at: 1700000000,
}

function makeFeedRow(overrides: Partial<FeedItem> = {}): FeedItem {
	return { ...baseFeedItem, ...overrides }
}

function mineSqlFrom(db: ReturnType<typeof makeMockDB>) {
	const call = db.calls.find((c) => /FROM lyrics\b/i.test(c.sql) && /submitter_id = \?/.test(c.sql))
	if (!call) throw new Error("expected a /mine submissions SELECT call")
	return call
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

describe("GET /lyrics/mine", () => {
	it("returns 401 when no x-key-id header is present", async () => {
		const db = makeMockDB()
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(new Request("http://localhost/lyrics/mine"))

		expect(res.status).toBe(401)
	})

	it("returns an empty page and undefined nextCursor when no rows match", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine", {
				headers: { "x-key-id": "user-key" },
			})
		)
		const body = (await res.json()) as { data: unknown[]; nextCursor?: number }

		expect(res.status).toBe(200)
		expect(body.data).toEqual([])
		expect(body.nextCursor).toBeUndefined()
	})

	it("uses the default stable ORDER BY when no sort params are provided", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		const { sql, params } = mineSqlFrom(db)
		expect(sql).toMatch(/ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(params[0]).toBe(42)
	})

	it("floors fractional cursor values before binding offset", async () => {
		const rows = Array.from({ length: 20 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([{ id: 42 }, rows])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?limit=20&cursor=40.7", {
				headers: { "x-key-id": "user-key" },
			})
		)

		const { params } = mineSqlFrom(db)
		expect(res.status).toBe(200)
		expect(params).toContain(40)
		expect(params).not.toContain(40.7)
	})

	it("forwards sort=most-voted into the ORDER BY clause", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?sort=most-voted&sortDir=desc", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		const { sql } = mineSqlFrom(db)
		expect(sql).toMatch(/ORDER BY\s+vote_count DESC,\s+id DESC/)
	})

	it("forwards syncType and tier filters into SQL and bound params", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?syncType=richsync&tier=top-rated", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		const { sql, params } = mineSqlFrom(db)
		expect(sql).toContain("sync_type = ?")
		expect(sql).toContain("confidence = 'high'")
		expect(params).toContain("richsync")
	})

	it("treats a non-numeric cursor as offset 0 and omits OFFSET from SQL", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?cursor=abc", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		expect(mineSqlFrom(db).sql).not.toContain("OFFSET")
	})

	it("treats a negative cursor as offset 0 and omits OFFSET from SQL", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?cursor=-5", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		expect(mineSqlFrom(db).sql).not.toContain("OFFSET")
	})

	it("emits nextCursor = offset + items.length when the page is full", async () => {
		const rows = Array.from({ length: 20 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([{ id: 42 }, rows, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?limit=20", {
				headers: { "x-key-id": "user-key" },
			})
		)
		const body = (await res.json()) as { data: unknown[]; nextCursor?: number }

		expect(res.status).toBe(200)
		expect(body.data).toHaveLength(20)
		expect(body.nextCursor).toBe(20)
	})

	it("accumulates nextCursor across pages by adding offset to items.length", async () => {
		const rows = Array.from({ length: 20 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([{ id: 42 }, rows, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?limit=20&cursor=40", {
				headers: { "x-key-id": "user-key" },
			})
		)
		const body = (await res.json()) as { data: unknown[]; nextCursor?: number }

		expect(res.status).toBe(200)
		expect(body.nextCursor).toBe(60)
	})

	it("omits nextCursor when the page is short", async () => {
		const rows = Array.from({ length: 3 }, (_, i) => makeFeedRow({ id: i + 1 }))
		const db = makeMockDB([{ id: 42 }, rows, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?limit=20", {
				headers: { "x-key-id": "user-key" },
			})
		)
		const body = (await res.json()) as { data: unknown[]; nextCursor?: number }

		expect(res.status).toBe(200)
		expect(body.data).toHaveLength(3)
		expect(body.nextCursor).toBeUndefined()
	})

	it("returns 200 with default ORDER BY when sort and syncType are unknown", async () => {
		const db = makeMockDB([{ id: 42 }, []])
		const app = lyricsRoutes(makeEnv(db))

		const res = await app.handle(
			new Request("http://localhost/lyrics/mine?sort=garbage&syncType=xml", {
				headers: { "x-key-id": "user-key" },
			})
		)

		expect(res.status).toBe(200)
		const { sql } = mineSqlFrom(db)
		expect(sql).toMatch(/ORDER BY\s+created_at DESC,\s+id DESC/)
		expect(sql).not.toMatch(/ORDER BY\s+vote_count/)
		expect(sql).not.toMatch(/ORDER BY\s+effective_score/)
		expect(sql).not.toMatch(/ORDER BY\s+created_at ASC/)
		expect(sql).not.toContain("sync_type = ?")
	})
})

const FORMAT_PARAM_INDEX = 10
const SYNC_TYPE_PARAM_INDEX = 12

function seedSubmitDB(keyId: string, publicJwk: JsonWebKey) {
	return makeMockDB([
		{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
		{ id: 7, key_id: keyId },
		{ count: 0 },
		{ id: 99 },
	])
}

async function submit(
	body: Record<string, unknown>
): Promise<{ res: Response; db: ReturnType<typeof makeMockDB> }> {
	const keyPair = await generateKeyPair()
	const publicJwk = await exportPublicJwk(keyPair)
	const keyId = await hashPublicKey(publicJwk)
	const db = seedSubmitDB(keyId, publicJwk)
	const env = makeEnv(db)
	const app = lyricsRoutes(env)
	const req = await buildSubmitRequest(keyPair, keyId, body)
	const res = await app.handle(req)
	return { res, db }
}

function findInsert(db: ReturnType<typeof makeMockDB>): DBCall | undefined {
	return db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))
}

describe("POST /lyrics/submit format override", () => {
	it("overrides plain claim with ttml when content is well-formed TTML", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "plain",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert).toBeDefined()
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("richsync")
	})

	it("overrides plain claim with lrc when content has line tags", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: "[00:01.00]Hello\n[00:03.00]World",
			format: "plain",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("lrc")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("linesync")
	})

	it("overrides lrc claim with plain when content has no timestamps", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: PLAIN_LRC,
			format: "lrc",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("plain")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("plain")
	})

	it("re-derives syncType from the detected format, ignoring the claimed syncType", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: "[00:01.00]Hello\n[00:03.00]World",
			format: "plain",
			syncType: "richsync",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("lrc")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("linesync")
	})

	it("leaves matching ttml/richsync claim untouched", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "ttml",
			syncType: "richsync",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("richsync")
	})

	it("rejects ttml claim with malformed content (no closing root) with 400", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: "<tt><body><div><p>missing close",
			format: "ttml",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { success: boolean; error: string; code: string }
		expect(body.success).toBe(false)
		expect(body.code).toBe("TTML_MALFORMED")
		expect(findInsert(db)).toBeUndefined()
	})

	it("rejects ttml claim with prose content with 400", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: "Just prose, no markup at all",
			format: "ttml",
		})

		expect(res.status).toBe(400)
		expect(findInsert(db)).toBeUndefined()
	})

	it("rejects ttml claim with LRC content with 400 (lying TTML claim)", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: "[00:01.00]Hello\n[00:03.00]World",
			format: "ttml",
		})

		expect(res.status).toBe(400)
		expect(findInsert(db)).toBeUndefined()
	})

	it("still enforces size cap before sniffing", async () => {
		const huge = "x".repeat(6 * 1024 * 1024)
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: huge,
			format: "plain",
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toMatch(/too large/i)
		expect(findInsert(db)).toBeUndefined()
	})

	it("overrides lrc claim with ttml when content is well-formed TTML", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "lrc",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("richsync")
	})

	it("stores valid TTML with no timing as ttml/plain", async () => {
		const untimedTtml = "<tt><body><div><p>Hello world</p><p>Second line</p></div></body></tt>"
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: untimedTtml,
			format: "ttml",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("plain")
	})

	it("treats empty-string syncType claim the same as omitted", async () => {
		const { res, db } = await submit({
			videoId: "abc123",
			song: "Song",
			artist: "Artist",
			duration: 200,
			lyrics: RICHSYNC_TTML,
			format: "ttml",
			syncType: "",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("richsync")
	})

	it("classifies row-431 shape (TTML wrongly claimed plain) as ttml/richsync", async () => {
		const row431 =
			'<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">' +
			'<body><div><p begin="0:01.428" end="0:04.847">' +
			'<span begin="0:01.428" end="0:01.731">Whoa,</span></p></div></body></tt>'

		const { res, db } = await submit({
			videoId: "HMeQT3FLJ3k",
			song: "Gravity",
			artist: "IRyS",
			duration: 240,
			lyrics: row431,
			format: "plain",
		})

		expect(res.status).toBe(201)
		const insert = findInsert(db)
		expect(insert?.params[FORMAT_PARAM_INDEX]).toBe("ttml")
		expect(insert?.params[SYNC_TYPE_PARAM_INDEX]).toBe("richsync")
	})

	it("4xx submission responses carry code, error, and hint fields", async () => {
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: "<tt><body><div><p>x",
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as {
			success: boolean
			error: string
			code: string
			hint: string
		}
		expect(body.success).toBe(false)
		expect(typeof body.error).toBe("string")
		expect(body.code).toBe("TTML_MALFORMED")
		expect(typeof body.hint).toBe("string")
		expect(body.hint.length).toBeGreaterThan(40)
	})
})

describe("POST /lyrics/submit formatted-TTML rejection", () => {
	it("rejects pretty-printed TTML with newlines between span siblings", async () => {
		const formatted =
			'<tt><body><div><p begin="0:00.0" end="0:02.0">\n  <span begin="0:00.0" end="0:01.0">Hello</span>\n  <span begin="0:01.0" end="0:02.0">world</span>\n</p></div></body></tt>'
		const { res, db } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: formatted,
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as {
			success: boolean
			code: string
			error: string
			hint: string
		}
		expect(body.success).toBe(false)
		expect(body.code).toBe("TTML_FORMATTED")
		expect(body.error).toBe("Formatted TTML")
		expect(body.hint).toMatch(/line breaks/i)
		expect(db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))).toBeUndefined()
	})

	it("rejects row-69 shape with a trailing-whitespace-specific hint", async () => {
		const row69Like =
			'<tt><body><div><p begin="0:00.0" end="0:01.0">' +
			'<span begin="0:00.0" end="0:01.0">Focus </span>' +
			'<span begin="0:01.0" end="0:02.0">Aim</span>' +
			"</p></div></body></tt>"
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: row69Like,
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string; hint: string }
		expect(body.code).toBe("TTML_FORMATTED")
		expect(body.hint).toMatch(/end/i)
	})

	it("rejects leading-whitespace-in-span with a leading-specific hint", async () => {
		const leading =
			'<tt><body><div><p begin="0:00.0" end="0:02.0">' +
			'<span begin="0:00.0" end="0:01.0">Hello</span>' +
			'<span begin="0:01.0" end="0:02.0"> world</span>' +
			"</p></div></body></tt>"
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: leading,
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string; hint: string }
		expect(body.code).toBe("TTML_FORMATTED")
		expect(body.hint).toMatch(/start with/i)
	})

	it("accepts clean single-line word-synced TTML (regression guard)", async () => {
		const clean =
			"<tt><body><div>" +
			'<p begin="0:00.0" end="0:02.0">' +
			'<span begin="0:00.0" end="0:01.0">Hello</span> ' +
			'<span begin="0:01.0" end="0:02.0">world</span>' +
			"</p></div></body></tt>"
		const { res, db } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: clean,
			format: "ttml",
		})
		expect(res.status).toBe(201)
		expect(db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))).toBeDefined()
	})

	it("accepts TTML with newlines between <p> siblings (line-level pretty-print OK)", async () => {
		const lineLevel =
			"<tt><body><div>\n" +
			'<p begin="0:00.0" end="0:02.0"><span begin="0:00.0" end="0:01.0">Hi</span> <span begin="0:01.0" end="0:02.0">there</span></p>\n' +
			'<p begin="0:02.0" end="0:04.0"><span begin="0:02.0" end="0:03.0">More</span> <span begin="0:03.0" end="0:04.0">words</span></p>\n' +
			"</div></body></tt>"
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: lineLevel,
			format: "ttml",
		})
		expect(res.status).toBe(201)
	})

	it("does not gate non-ttml submissions", async () => {
		const lrc = "[00:01.00]Hello\n[00:03.00]World"
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: lrc,
			format: "lrc",
		})
		expect(res.status).toBe(201)
	})

	it("triggers on pretty-printed TTML content even when claim is plain", async () => {
		const formatted =
			'<tt><body><div><p begin="0:00.0" end="0:02.0">\n  <span begin="0:00.0" end="0:01.0">Hello</span>\n  <span begin="0:01.0" end="0:02.0">world</span>\n</p></div></body></tt>'
		const { res, db } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: formatted,
			format: "plain",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string }
		expect(body.code).toBe("TTML_FORMATTED")
		expect(db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))).toBeUndefined()
	})

	it("prefers inter-span-newline hint over trailing-whitespace when both are present", async () => {
		const both =
			'<tt><body><div><p begin="0:00.0" end="0:02.0">\n' +
			'<span begin="0:00.0" end="0:01.0">Focus </span>\n' +
			'<span begin="0:01.0" end="0:02.0">Aim </span>\n' +
			"</p></div></body></tt>"
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: both,
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string; hint: string }
		expect(body.code).toBe("TTML_FORMATTED")
		expect(body.hint).toMatch(/line breaks/i)
	})

	it("rejects pretty-printed TTML carried in a format=plain claim with no DB write", async () => {
		const formatted =
			'<tt><body><div><p>\n<span begin="0:00.0" end="0:01.0">Hi</span>\n<span begin="0:01.0" end="0:02.0">there</span>\n</p></div></body></tt>'
		const { res, db } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: formatted,
			format: "plain",
		})
		expect(res.status).toBe(400)
		expect(db.calls.find((c) => /INSERT INTO lyrics/i.test(c.sql))).toBeUndefined()
		expect(db.calls.find((c) => /UPDATE lyrics/i.test(c.sql))).toBeUndefined()
	})

	it("malformed-TTML gate fires before formatted-TTML gate when both would apply", async () => {
		const both =
			'<tt><body><div><p>\n<span begin="0:00.0" end="0:01.0">Hi</span>\n<span begin="0:01.0" end="0:02.0">there</span>\n</p></div></body>'
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: both,
			format: "ttml",
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as { code: string }
		expect(body.code).toBe("TTML_MALFORMED")
	})

	it("rejects with the canonical TTML_FORMATTED error string", async () => {
		const formatted =
			'<tt><body><div><p>\n<span begin="0:00.0" end="0:01.0">Hi</span>\n<span begin="0:01.0" end="0:02.0">there</span>\n</p></div></body></tt>'
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: formatted,
			format: "ttml",
		})
		const body = (await res.json()) as { error: string; hint: string; code: string }
		expect(body.code).toBe("TTML_FORMATTED")
		expect(body.error).toBe("Formatted TTML")
		expect(body.hint.length).toBeGreaterThan(40)
	})

	it("each reason returns a distinct, non-empty hint", async () => {
		const interSpan =
			'<tt><body><div><p>\n<span begin="0:00.0" end="0:01.0">a</span>\n<span begin="0:01.0" end="0:02.0">b</span>\n</p></div></body></tt>'
		const trailing =
			'<tt><body><div><p><span begin="0:00.0" end="0:01.0">a </span><span begin="0:01.0" end="0:02.0">b</span></p></div></body></tt>'
		const leading =
			'<tt><body><div><p><span begin="0:00.0" end="0:01.0">a</span><span begin="0:01.0" end="0:02.0"> b</span></p></div></body></tt>'

		const results = await Promise.all(
			[interSpan, trailing, leading].map((lyrics) =>
				submit({
					videoId: "abc",
					song: "S",
					artist: "A",
					duration: 100,
					lyrics,
					format: "ttml",
				}),
			),
		)
		const hints = await Promise.all(results.map(({ res }) => res.json() as Promise<{ hint: string }>))
		expect(new Set(hints.map((h) => h.hint)).size).toBe(3)
	})

	it("accepts adjacent-syllable spans without inter-span whitespace (regression guard)", async () => {
		const ttml =
			'<tt><body><div><p>' +
			'<span begin="0:00.0" end="0:00.5">Hel</span>' +
			'<span begin="0:00.5" end="0:01.0">lo</span>' +
			'</p></div></body></tt>'
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: ttml,
			format: "ttml",
		})
		expect(res.status).toBe(201)
	})

	it("accepts background-span container with clean inner spans", async () => {
		const ttml =
			'<tt><body><div><p>' +
			'<span begin="0:00.0" end="0:01.0">Main</span> ' +
			'<span ttm:role="x-bg">' +
			'<span begin="0:00.5" end="0:01.0">bg</span>' +
			'</span>' +
			'</p></div></body></tt>'
		const { res } = await submit({
			videoId: "abc",
			song: "S",
			artist: "A",
			duration: 100,
			lyrics: ttml,
			format: "ttml",
		})
		expect(res.status).toBe(201)
	})
})
