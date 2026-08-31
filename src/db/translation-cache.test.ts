import { createHash } from "node:crypto"
import { config } from "@/config"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import {
	type TranslationCacheRow,
	type TranslationLine,
	computeLyricsHash,
	getTranslationCache,
	recordTranslationFailure,
	upsertTranslationCache,
} from "./translation-cache"

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

const SAMPLE_LINES: TranslationLine[] = [
	{
		i: 0,
		original: "Bonjour le monde",
		translation: "Hello world",
		romanization: null,
		needsTranslation: true,
	},
	{
		i: 1,
		original: "Comment ça va",
		translation: "How are you",
		romanization: null,
		needsTranslation: true,
	},
]

function makeRow(overrides: Partial<TranslationCacheRow> = {}): TranslationCacheRow {
	return {
		lyricsHash: computeLyricsHash("fr", "en", ["Bonjour le monde", "Comment ça va"]),
		fromLang: "fr",
		toLang: "en",
		provider: config.translation.provider,
		videoId: "dQw4w9WgXcQ",
		lineCount: 2,
		detectedSourceLang: "fr",
		hasRomanization: false,
		isNegative: false,
		sourceLines: ["Bonjour le monde", "Comment ça va"],
		lines: SAMPLE_LINES,
		googleVersion: "v1",
		googleId: "gid-123",
		googleToken: "tok-456",
		httpStatus: 200,
		rawPayload: '{"raw":true}',
		parserVersion: config.translation.parserVersion,
		failureCount: 0,
		...overrides,
	}
}

function dbRowFromCacheRow(row: TranslationCacheRow, jsonbAsString = false) {
	return {
		lyrics_hash: row.lyricsHash,
		from_lang: row.fromLang,
		to_lang: row.toLang,
		provider: row.provider,
		video_id: row.videoId,
		line_count: row.lineCount,
		detected_source_lang: row.detectedSourceLang,
		has_romanization: row.hasRomanization,
		is_negative: row.isNegative,
		source_lines: jsonbAsString ? JSON.stringify(row.sourceLines) : row.sourceLines,
		lines: jsonbAsString ? JSON.stringify(row.lines) : row.lines,
		google_version: row.googleVersion,
		google_id: row.googleId,
		google_token: row.googleToken,
		http_status: row.httpStatus,
		raw_payload: row.rawPayload,
		parser_version: row.parserVersion,
		failure_count: row.failureCount,
	}
}

describe("computeLyricsHash", () => {
	it("is deterministic for identical inputs", () => {
		const a = computeLyricsHash("en", "es", ["Hello", "World"])
		const b = computeLyricsHash("en", "es", ["Hello", "World"])
		expect(a).toBe(b)
	})

	it("matches a known vector", () => {
		expect(computeLyricsHash("en", "es", ["Hello", "World"])).toBe(
			"b0955455d93f39c87dde9d290f6d1fd3c919ea2cfb44d4ff1667f9131cfc7968"
		)
	})

	it("trims each line so padded input hashes the same as pre-trimmed input", () => {
		const padded = computeLyricsHash("en", "es", ["  Hello  ", "\tWorld \n"])
		const clean = computeLyricsHash("en", "es", ["Hello", "World"])
		expect(padded).toBe(clean)
	})

	it("is order sensitive", () => {
		const forward = computeLyricsHash("en", "es", ["Hello", "World"])
		const reversed = computeLyricsHash("en", "es", ["World", "Hello"])
		expect(forward).not.toBe(reversed)
	})

	it("includes the from language in the hash", () => {
		const en = computeLyricsHash("en", "es", ["Hello"])
		const de = computeLyricsHash("de", "es", ["Hello"])
		expect(en).not.toBe(de)
	})

	it("includes the to language in the hash", () => {
		const es = computeLyricsHash("en", "es", ["Hello"])
		const fr = computeLyricsHash("en", "fr", ["Hello"])
		expect(es).not.toBe(fr)
	})

	it("returns a 64-char lowercase hex digest", () => {
		expect(computeLyricsHash("en", "es", ["Hello"])).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe("getTranslationCache", () => {
	it("selects on the key predicates, parser version, and unexpired rows only", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		await getTranslationCache(env, { lyricsHash: "abc", from: "fr", to: "en" })
		const sql = db.calls[0].sql
		expect(sql).toMatch(/lyrics_hash\s*=\s*\?/)
		expect(sql).toMatch(/from_lang\s*=\s*\?/)
		expect(sql).toMatch(/to_lang\s*=\s*\?/)
		expect(sql).toMatch(/provider\s*=\s*\?/)
		expect(sql).toMatch(/parser_version\s*=\s*\?/)
		expect(sql).toMatch(/expires_at\s*>\s*now\(\)/)
	})

	it("binds the key params in order", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		await getTranslationCache(env, {
			lyricsHash: "hash-1",
			from: "fr",
			to: "en",
			provider: "custom-provider",
		})
		expect(db.calls[0].params).toEqual([
			"hash-1",
			"fr",
			"en",
			"custom-provider",
			config.translation.parserVersion,
		])
	})

	it("scopes the lookup to the current parser version so a bump invalidates old rows", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		await getTranslationCache(env, { lyricsHash: "hash-1", from: "fr", to: "en" })
		expect(db.calls[0].params[4]).toBe(config.translation.parserVersion)
	})

	it("defaults provider to config.translation.provider when omitted", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		await getTranslationCache(env, { lyricsHash: "hash-1", from: "fr", to: "en" })
		expect(db.calls[0].params[3]).toBe(config.translation.provider)
	})

	it("maps snake_case columns into a TranslationCacheRow", async () => {
		const row = makeRow()
		const db = makeMockDB([dbRowFromCacheRow(row)])
		const env = makeEnv(db)
		const result = await getTranslationCache(env, {
			lyricsHash: row.lyricsHash,
			from: "fr",
			to: "en",
		})
		expect(result).toEqual(row)
	})

	it("returns null when no row matches", async () => {
		const db = makeMockDB([])
		const env = makeEnv(db)
		const result = await getTranslationCache(env, { lyricsHash: "missing", from: "fr", to: "en" })
		expect(result).toBeNull()
	})

	it("defensively parses jsonb columns that arrive as raw strings", async () => {
		const row = makeRow()
		const db = makeMockDB([dbRowFromCacheRow(row, true)])
		const env = makeEnv(db)
		const result = await getTranslationCache(env, {
			lyricsHash: row.lyricsHash,
			from: "fr",
			to: "en",
		})
		expect(result?.sourceLines).toEqual(row.sourceLines)
		expect(result?.lines).toEqual(row.lines)
	})
})

describe("upsertTranslationCache", () => {
	const MUTABLE_COLUMNS = [
		"video_id",
		"line_count",
		"detected_source_lang",
		"has_romanization",
		"is_negative",
		"source_lines",
		"lines",
		"google_version",
		"google_id",
		"google_token",
		"http_status",
		"raw_payload",
		"parser_version",
		"expires_at",
	]

	it("targets the composite unique key in ON CONFLICT", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow())
		expect(db.calls[0].sql).toMatch(
			/ON CONFLICT\s*\(\s*lyrics_hash,\s*from_lang,\s*to_lang,\s*provider\s*\)/
		)
	})

	it("updates every mutable column plus updated_at on conflict", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow())
		const sql = db.calls[0].sql
		const doUpdate = sql.slice(sql.indexOf("DO UPDATE SET"))
		for (const col of MUTABLE_COLUMNS) {
			expect(doUpdate).toContain(`${col} = EXCLUDED.${col}`)
		}
		expect(doUpdate).toMatch(/updated_at\s*=\s*now\(\)/)
	})

	it("passes source_lines and lines as JSON strings, not raw arrays", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		const row = makeRow()
		await upsertTranslationCache(env, row)
		const sourceLinesParam = db.calls[0].params[9]
		const linesParam = db.calls[0].params[10]
		expect(typeof sourceLinesParam).toBe("string")
		expect(typeof linesParam).toBe("string")
		expect(JSON.parse(sourceLinesParam as string)).toEqual(row.sourceLines)
		expect(JSON.parse(linesParam as string)).toEqual(row.lines)
	})

	it("computes expires_at via a SQL interval expression", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow())
		expect(db.calls[0].sql).toMatch(/now\(\)\s*\+\s*\(\?\s*\|\|\s*' seconds'\)::interval/)
	})

	it("uses the positive TTL for a positive entry", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow({ isNegative: false }))
		expect(db.calls[0].params.at(-1)).toBe(config.translation.positiveTtlSeconds)
	})

	it("uses the negative TTL for a negative entry", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow({ isNegative: true }))
		expect(db.calls[0].params.at(-1)).toBe(config.translation.negativeTtlSeconds)
	})

	it("resets failure_count to 0 so a success clears prior failures", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow())
		const sql = db.calls[0].sql
		const doUpdate = sql.slice(sql.indexOf("DO UPDATE SET"))
		expect(doUpdate).toMatch(/failure_count\s*=\s*0/)
	})
})

describe("recordTranslationFailure", () => {
	const failure = {
		lyricsHash: "hash-x",
		fromLang: "zh",
		toLang: "en",
		provider: config.translation.provider,
		videoId: null,
		lineCount: 2,
		detectedSourceLang: "zh",
		httpStatus: 200,
		rawPayload: "<div>unparseable</div>",
	}

	it("increments the counter and flips is_negative at the threshold on conflict", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await recordTranslationFailure(env, failure)
		const sql = db.calls[0].sql
		expect(sql).toMatch(/INSERT INTO translation_cache/i)
		const doUpdate = sql.slice(sql.indexOf("DO UPDATE SET"))
		expect(doUpdate).toMatch(/failure_count = translation_cache\.failure_count \+ 1/)
		expect(doUpdate).toMatch(/is_negative = \(translation_cache\.failure_count \+ 1\) >= \?/)
	})

	it("inserts the first failure with count 1, is_negative false, and empty jsonb", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await recordTranslationFailure(env, failure)
		const sql = db.calls[0].sql
		const values = sql.slice(sql.indexOf("VALUES"), sql.indexOf("ON CONFLICT"))
		expect(values).toContain("FALSE")
		expect(values).toMatch(/'\[\]'::jsonb/)
	})

	it("binds the failure context, parser version, negative TTL, and threshold in order", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await recordTranslationFailure(env, failure)
		const params = db.calls[0].params
		expect(params.slice(0, 7)).toEqual([
			"hash-x",
			"zh",
			"en",
			config.translation.provider,
			null,
			2,
			"zh",
		])
		expect(params[7]).toBe(200)
		expect(params[8]).toBe("<div>unparseable</div>")
		expect(params[9]).toBe(config.translation.parserVersion)
		expect(params[10]).toBe(config.translation.negativeTtlSeconds)
		expect(params[11]).toBe(config.translation.negativeThreshold)
	})
})

describe("edge cases", () => {
	it("hashes an empty lines array without throwing", () => {
		expect(computeLyricsHash("en", "es", [])).toMatch(/^[0-9a-f]{64}$/)
	})

	it("hashes a single line", () => {
		expect(computeLyricsHash("en", "es", ["Only one"])).toMatch(/^[0-9a-f]{64}$/)
	})

	it("hashes unicode lines", () => {
		expect(computeLyricsHash("ja", "en", ["こんにちは世界", "さようなら"])).toMatch(
			/^[0-9a-f]{64}$/
		)
	})

	it("treats whitespace-only lines as empty after trimming", () => {
		const spaces = computeLyricsHash("en", "es", ["   ", "\t\t"])
		const empties = computeLyricsHash("en", "es", ["", ""])
		expect(spaces).toBe(empties)
	})

	it("round-trips an empty sourceLines/lines upsert as JSON strings", async () => {
		const db = makeMockDB([undefined])
		const env = makeEnv(db)
		await upsertTranslationCache(env, makeRow({ sourceLines: [], lines: [], lineCount: 0 }))
		expect(db.calls[0].params[9]).toBe("[]")
		expect(db.calls[0].params[10]).toBe("[]")
	})
})

describe("invariants", () => {
	it("computeLyricsHash is idempotent across repeated calls", () => {
		const first = computeLyricsHash("fr", "en", ["a", "b", "c"])
		const second = computeLyricsHash("fr", "en", ["a", "b", "c"])
		const third = computeLyricsHash("fr", "en", ["a", "b", "c"])
		expect(new Set([first, second, third]).size).toBe(1)
	})

	it("computeLyricsHash equals a direct sha256 of the documented preimage", () => {
		const preimage = `en es ${["Hello", "World"].join("\n")}`
		const expected = createHash("sha256").update(preimage).digest("hex")
		expect(computeLyricsHash("en", "es", ["Hello", "World"])).toBe(expected)
	})
})
