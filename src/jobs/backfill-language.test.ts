import type { Env } from "@/types"
import { compress } from "@/utils/compression"
import { DETECTOR_VERSION } from "@/utils/detect-language"
import { describe, expect, it } from "vitest"
import { backfillLanguage } from "./backfill-language"

interface DBCall {
	sql: string
	params: unknown[]
}

function makeMockDB(scripted: Array<unknown[] | unknown>) {
	const calls: DBCall[] = []
	const queue = [...scripted]
	const db = {
		calls,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return (next as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return { results: (next as T[]) ?? [] }
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

function makeMockCache(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial))
	const deleteCalls: string[] = []
	const keysCalls: string[] = []
	return {
		store,
		deleteCalls,
		keysCalls,
		async get(key: string) {
			return store.get(key) ?? null
		},
		async put() {},
		async delete(key: string) {
			deleteCalls.push(key)
			store.delete(key)
		},
		async keys(pattern: string) {
			keysCalls.push(pattern)
			const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)
			return [...store.keys()].filter((k) => re.test(k))
		},
		async setNX() {
			return true
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
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

const ENGLISH_LYRICS_SAMPLE = [
	"In your arms I find the answer to every question",
	"You whisper softly and the world begins to spin",
	"Holding on tight to the moments we have together",
	"Every heartbeat is a song that only we can hear",
].join("\n")

describe("backfillLanguage", () => {
	it("selects rows below the current detector version, excludes deleted and submitter-set rows", async () => {
		const db = makeMockDB([[{ id: 1, lyrics: ENGLISH_LYRICS_SAMPLE, format: "plain" }], null, []])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		const selectCall = db.calls.find((c) => c.sql.includes("SELECT"))
		expect(selectCall!.sql).toContain("language_detector_version IS NULL")
		expect(selectCall!.sql).toContain("language_detector_version <")
		expect(selectCall!.sql).toContain("deleted_at IS NULL")
		expect(selectCall!.sql).toContain("language_source")
		expect(selectCall!.sql).toContain("'submitter'")
		expect(selectCall!.params[0]).toBe(DETECTOR_VERSION)
	})

	it("stamps language, source='detector', attempted_at, and detector_version on success", async () => {
		const db = makeMockDB([[{ id: 7, lyrics: ENGLISH_LYRICS_SAMPLE, format: "plain" }], null, []])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		const updateCall = db.calls.find((c) => c.sql.includes("UPDATE lyrics"))
		expect(updateCall!.sql).toContain("language = ?")
		expect(updateCall!.sql).toContain("language_source = 'detector'")
		expect(updateCall!.sql).toContain("language_detection_attempted_at = NOW()")
		expect(updateCall!.sql).toContain("language_detector_version = ?")
		expect(updateCall!.params).toContain("en")
		expect(updateCall!.params).toContain(DETECTOR_VERSION)
		expect(updateCall!.params).toContain(7)
	})

	it("clears language to null when re-detection cannot identify a language", async () => {
		const db = makeMockDB([[{ id: 8, lyrics: "oh oh", format: "plain" }], null, []])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		const updateCall = db.calls.find((c) => c.sql.includes("UPDATE lyrics"))
		expect(updateCall!.sql).not.toContain("COALESCE")
		expect(updateCall!.params).toContain(null)
		expect(updateCall!.params).toContain(DETECTOR_VERSION)
	})

	it("is a no-op (no UPDATE) when there are no candidate rows", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		expect(db.calls.some((c) => c.sql.includes("UPDATE lyrics"))).toBe(false)
	})

	it("decompresses compressed lyrics before detection", async () => {
		const compressed = await compress(ENGLISH_LYRICS_SAMPLE)
		const db = makeMockDB([[{ id: 9, lyrics: compressed, format: "plain" }], null, []])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		const updateCall = db.calls.find((c) => c.sql.includes("UPDATE lyrics"))
		expect(updateCall!.params).toContain("en")
	})

	it("continues processing and stamps version when a row throws on decompress", async () => {
		const valid = await compress(ENGLISH_LYRICS_SAMPLE)
		const corruptedButLooksCompressed = "H4sIAAAAAA_NOTVALIDBASE64DATA"
		const db = makeMockDB([
			[
				{ id: 100, lyrics: corruptedButLooksCompressed, format: "plain" },
				{ id: 101, lyrics: valid, format: "plain" },
			],
			null,
			null,
			[],
		])
		const env = makeEnv(db, makeMockCache())

		await backfillLanguage(env)

		const updates = db.calls.filter((c) => c.sql.includes("UPDATE lyrics"))
		expect(updates.length).toBeGreaterThanOrEqual(2)

		const errStamp = updates.find((c) => c.params.includes(100))
		expect(errStamp).toBeDefined()
		expect(errStamp!.sql).toContain("language_detector_version = ?")
		expect(errStamp!.params).toContain(DETECTOR_VERSION)

		const successUpdate = updates.find((c) => c.params.includes(101))
		expect(successUpdate).toBeDefined()
		expect(successUpdate!.params).toContain("en")
	})
})
