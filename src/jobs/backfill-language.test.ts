import type { Env, LyricsFormat } from "@/types"
import { compress } from "@/utils/compression"
import { DETECTOR_VERSION } from "@/utils/detect-language"
import { describe, expect, it } from "vitest"
import { backfillLanguage } from "./backfill-language"

interface Recorded {
	sql: string
	params: unknown[]
}

function createPagedDB(pages: Array<Array<{ id: number; lyrics: string; format: LyricsFormat }>>) {
	const calls: Recorded[] = []
	let pageIndex = 0
	return {
		calls,
		prepare(sql: string) {
			return {
				bind(...params: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params })
							return null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params })
							if (/SELECT/i.test(sql) && /lyrics/i.test(sql)) {
								const page = pages[pageIndex++] ?? []
								return { results: page as unknown as T[] }
							}
							return { results: [] as T[] }
						},
						async run(): Promise<void> {
							calls.push({ sql, params })
						},
					}
				},
			}
		},
	}
}

function buildEnv(db: ReturnType<typeof createPagedDB>): Env {
	return {
		DB: db,
		CACHE: {
			get: async () => null,
			put: async () => undefined,
			delete: async () => undefined,
			keys: async () => [],
		},
		CACHE_TTL_SECONDS: "0",
		RATE_LIMITER: { check: async () => ({ ok: true, remaining: 0 }) },
	} as unknown as Env
}

async function compressed(text: string): Promise<string> {
	return compress(text)
}

const KO = "안녕하세요 반갑습니다 좋은 하루 되세요 사랑합니다"
const EN = "Hello darkness my old friend I've come to talk with you again"
const FR = "Non rien de rien non je ne regrette rien"

describe("backfillLanguage", () => {
	it("stamps detected language and version for each row", async () => {
		const db = createPagedDB([
			[
				{ id: 1, lyrics: await compressed(KO), format: "plain" },
				{ id: 2, lyrics: await compressed(EN), format: "plain" },
			],
		])

		const result = await backfillLanguage(buildEnv(db))

		expect(result).toEqual({ scanned: 2, updated: 2 })
		const updates = db.calls.filter((c) => /UPDATE lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
		expect(updates[0].params).toEqual(["ko", DETECTOR_VERSION, 1])
		expect(updates[1].params).toEqual(["en", DETECTOR_VERSION, 2])
		expect(updates[0].sql).toMatch(/language_source/i)
		expect(updates[0].sql).toMatch(/language_detector_version/i)
	})

	it("stamps null language with the current version for undetectable text", async () => {
		const db = createPagedDB([
			[{ id: 7, lyrics: await compressed("12345 67890 000"), format: "plain" }],
		])

		const result = await backfillLanguage(buildEnv(db))

		expect(result).toEqual({ scanned: 1, updated: 0 })
		const update = db.calls.find((c) => /UPDATE lyrics/i.test(c.sql))
		expect(update!.params).toEqual([null, DETECTOR_VERSION, 7])
	})

	it("stops when a page comes back empty", async () => {
		const db = createPagedDB([[{ id: 1, lyrics: await compressed(EN), format: "plain" }], []])

		const result = await backfillLanguage(buildEnv(db))

		expect(result.scanned).toBe(1)
		const selects = db.calls.filter((c) => /SELECT/i.test(c.sql))
		expect(selects).toHaveLength(2)
	})

	it("processes multiple non-empty pages before stopping", async () => {
		const db = createPagedDB([
			[{ id: 1, lyrics: await compressed(EN), format: "plain" }],
			[{ id: 2, lyrics: await compressed(FR), format: "plain" }],
			[],
		])

		const result = await backfillLanguage(buildEnv(db))

		expect(result).toEqual({ scanned: 2, updated: 2 })
		const selects = db.calls.filter((c) => /SELECT/i.test(c.sql))
		expect(selects).toHaveLength(3)
		const updates = db.calls.filter((c) => /UPDATE lyrics/i.test(c.sql))
		expect(updates[0].params[0]).toBe("en")
		expect(updates[1].params[0]).toBe("fr")
	})
})
