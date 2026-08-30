import { readFileSync } from "node:fs"
import { config } from "@/config"
import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { translateRoutes } from "./translate"

function fixture(name: string): string {
	return readFileSync(
		new URL(`../utils/__fixtures__/google-lyrics-translate/${name}.txt`, import.meta.url),
		"utf8"
	)
}

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
}

interface MockDB {
	calls: DBCall[]
	queue: unknown[]
	prepare(sql: string): MockStatement
}

function makeMockDB(queue: unknown[] = []): MockDB {
	const calls: DBCall[] = []
	const db: MockDB = {
		calls,
		queue,
		prepare(sql: string) {
			return new MockStatement(sql, db)
		},
	}
	return db
}

function makeMockCache() {
	const store: Record<string, string> = {}
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

function makeEnv(db: MockDB, translationProxyEnabled = true): Env {
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
		TRANSLATION_PROXY_ENABLED: translationProxyEnabled,
	}
}

interface StoredLine {
	i: number
	original: string
	translation: string | null
	romanization: string | null
	needsTranslation: boolean
}

function storedRow(lines: StoredLine[]) {
	return {
		lyrics_hash: "hash",
		from_lang: "zh",
		to_lang: "en",
		provider: config.translation.provider,
		video_id: null,
		line_count: lines.length,
		detected_source_lang: "zh",
		has_romanization: lines.some((l) => l.romanization !== null),
		is_negative: false,
		source_lines: lines.map((l) => l.original),
		lines,
		google_version: "v-stored",
		google_id: "stored-id",
		google_token: "stored-token",
		http_status: 200,
		raw_payload: null,
		parser_version: config.translation.parserVersion,
	}
}

type TranslateRoutes = typeof translateRoutes

function post(app: ReturnType<TranslateRoutes>, body: unknown) {
	return app.handle(
		new Request("http://localhost/translate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})
	)
}

async function loadFreshRoutes(env: Record<string, string> = {}): Promise<TranslateRoutes> {
	vi.resetModules()
	for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
	const mod = await import("./translate")
	return mod.translateRoutes
}

interface ResponseLine {
	translation: string | null
	romanization: string | null
	needsTranslation: boolean
}

interface TranslateOk {
	lines: ResponseLine[]
	detectedLang: string
	provider: string
	cached: boolean
}

interface TranslateErr {
	success: false
	error: string
}

const HELLO_WORLD_LINE: StoredLine = {
	i: 0,
	original: "你好世界",
	translation: "Hello World",
	romanization: "Nǐ hǎo shìjiè",
	needsTranslation: true,
}

const INSERT_RE = /INSERT INTO translation_cache/i

afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
	vi.resetModules()
})

describe("POST /translate", () => {
	it("returns a cached translation without hitting the network", async () => {
		const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([storedRow([HELLO_WORLD_LINE])])
		const app = translateRoutes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(200)
		const json = (await res.json()) as TranslateOk
		expect(json).toEqual({
			lines: [
				{ translation: "Hello World", romanization: "Nǐ hǎo shìjiè", needsTranslation: true },
			],
			detectedLang: "zh",
			provider: config.translation.provider,
			cached: true,
		})
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(db.calls.some((c) => INSERT_RE.test(c.sql))).toBe(false)
	})

	it("fetches, caches, and returns a fresh translation on a cache miss", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-single-line"), {
					status: 200,
					headers: { version: "v-42" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(200)
		const json = (await res.json()) as TranslateOk
		expect(json.cached).toBe(false)
		expect(json.detectedLang).toBe("zh")
		expect(json.provider).toBe(config.translation.provider)
		expect(json.lines).toEqual([
			{ translation: "Hello World", romanization: "Nǐ hǎo shìjiè", needsTranslation: true },
		])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const insert = db.calls.find((c) => INSERT_RE.test(c.sql))
		expect(insert).toBeDefined()
	})

	it("persists videoId and a computed has_romanization on the cache row", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-single-line"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		await post(app, { lines: ["你好世界"], to: "en", from: "zh", videoId: "dQw4w9WgXcQ" })

		const insert = db.calls.find((c) => INSERT_RE.test(c.sql))
		expect(insert?.params[4]).toBe("dQw4w9WgXcQ")
		expect(insert?.params[7]).toBe(true)
	})

	it("stores has_romanization false when the upstream returns no romanization", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("ja-en-no-romanization"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		await post(app, { lines: ["夜に駆ける", "君の名は"], to: "en", from: "ja" })

		const insert = db.calls.find((c) => INSERT_RE.test(c.sql))
		expect(insert?.params[4]).toBeNull()
		expect(insert?.params[7]).toBe(false)
	})

	it("strips blank lines before the upstream call and reinserts them in the response", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response(fixture("zh-en-blank-line-split"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好", "", "世界"], to: "en", from: "zh" })

		expect(res.status).toBe(200)
		const json = (await res.json()) as TranslateOk
		expect(json.lines).toEqual([
			{ translation: "Hello", romanization: "Nǐ hǎo", needsTranslation: true },
			{ translation: null, romanization: null, needsTranslation: false },
			{ translation: "world", romanization: "Shìjiè", needsTranslation: true },
		])
		const url = fetchSpy.mock.calls[0][0]
		expect(url).not.toContain("%0A%0A")
		const insert = db.calls.find((c) => INSERT_RE.test(c.sql))
		expect(insert?.params[5]).toBe(2)
		expect(insert?.params[9]).toBe(JSON.stringify(["你好", "世界"]))
	})

	it("returns 503 when the outbound throttle refuses a slot", async () => {
		const routes = await loadFreshRoutes({
			GOOGLE_BURST: "0",
			GOOGLE_RATE_PER_SEC: "0",
			GOOGLE_MAX_QUEUE_WAIT_MS: "0",
		})
		const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(503)
		const json = (await res.json()) as TranslateErr
		expect(json.success).toBe(false)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("returns 502 when the upstream fails and writes no cache row", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(async () => new Response("upstream boom", { status: 502 }))
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(502)
		const json = (await res.json()) as TranslateErr
		expect(json.success).toBe(false)
		expect(db.calls.some((c) => INSERT_RE.test(c.sql))).toBe(false)
	})

	it("still returns the translation when the cache write fails", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-single-line"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const originalPrepare = db.prepare
		db.prepare = (sql: string) => {
			const stmt = originalPrepare(sql)
			if (INSERT_RE.test(sql)) {
				stmt.run = async () => {
					throw new Error("db down")
				}
			}
			return stmt
		}
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(200)
		const json = (await res.json()) as TranslateOk
		expect(json.cached).toBe(false)
		expect(json.lines[0].translation).toBe("Hello World")
	})

	it("returns 400 when no line is translatable", async () => {
		const db = makeMockDB()
		const app = translateRoutes(makeEnv(db))

		const res = await post(app, { lines: ["", "♪", "  "], to: "en" })

		expect(res.status).toBe(400)
		const json = (await res.json()) as TranslateErr
		expect(json.success).toBe(false)
	})

	it("returns 400 when from is omitted and detection cannot resolve it", async () => {
		vi.stubEnv("DETECTION_URL", "")
		const db = makeMockDB()
		const app = translateRoutes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en" })

		expect(res.status).toBe(400)
		const json = (await res.json()) as TranslateErr
		expect(json.success).toBe(false)
	})

	it("returns 404 when the proxy flag is disabled", async () => {
		const db = makeMockDB()
		const app = translateRoutes(makeEnv(db, false))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		expect(res.status).toBe(404)
	})
})

describe("edge cases", () => {
	it("treats a lone ♪ marker as a blank position", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-blank-line-split"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好", "♪", "世界"], to: "en", from: "zh" })

		const json = (await res.json()) as TranslateOk
		expect(json.lines[1]).toEqual({
			translation: null,
			romanization: null,
			needsTranslation: false,
		})
		expect(json.lines).toHaveLength(3)
	})

	it("ignores a cached row whose line count no longer matches the request", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-blank-line-split"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([storedRow([HELLO_WORLD_LINE])])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好", "世界"], to: "en", from: "zh" })

		const json = (await res.json()) as TranslateOk
		expect(json.cached).toBe(false)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	it("preserves a null romanization from the cached row", async () => {
		const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const line: StoredLine = {
			i: 0,
			original: "夜に駆ける",
			translation: "run into the night",
			romanization: null,
			needsTranslation: true,
		}
		const db = makeMockDB([storedRow([line])])
		const app = translateRoutes(makeEnv(db))

		const res = await post(app, { lines: ["夜に駆ける"], to: "en", from: "ja" })

		const json = (await res.json()) as TranslateOk
		expect(json.lines[0].romanization).toBeNull()
		expect(json.cached).toBe(true)
	})
})

describe("invariants", () => {
	it("aligns the response one-to-one with the request lines", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-blank-line-split"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const request = { lines: ["你好", "", "世界"], to: "en", from: "zh" }
		const res = await post(app, request)

		const json = (await res.json()) as TranslateOk
		expect(json.lines).toHaveLength(request.lines.length)
	})

	it("echoes the caller-supplied from as detectedLang", async () => {
		const routes = await loadFreshRoutes()
		const fetchSpy = vi.fn(
			async () =>
				new Response(fixture("zh-en-single-line"), {
					status: 200,
					headers: { version: "v-1" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)
		const db = makeMockDB([null])
		const app = routes(makeEnv(db))

		const res = await post(app, { lines: ["你好世界"], to: "en", from: "zh" })

		const json = (await res.json()) as TranslateOk
		expect(json.detectedLang).toBe("zh")
	})
})
