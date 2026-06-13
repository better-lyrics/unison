import type { Env, LyricsFormat } from "@/types"
import { compress } from "@/utils/compression"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

describe("backfillLanguage", () => {
	beforeEach(() => {
		vi.stubEnv("DETECTION_URL", "http://detect.test")
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it("returns 0/0 and logs a warning when DETECTION_URL is unset", async () => {
		vi.unstubAllEnvs()
		const db = createPagedDB([])
		const env = buildEnv(db)
		const fetchSpy = vi.fn()
		vi.stubGlobal("fetch", fetchSpy)

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 0, updated: 0 })
		expect(fetchSpy).not.toHaveBeenCalled()
		const select = db.calls.find((c) => /SELECT/i.test(c.sql))
		expect(select).toBeUndefined()
	})

	it("stamps detected language and version when the service answers", async () => {
		const db = createPagedDB([
			[
				{
					id: 1,
					lyrics: await compressed("안녕하세요 반갑습니다 좋은 하루 되세요"),
					format: "plain",
				},
				{ id: 2, lyrics: await compressed("hello world hello world hello world"), format: "plain" },
			],
		])
		const env = buildEnv(db)
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						results: [
							{ iso6391: "ko", confidence: 0.93 },
							{ iso6391: "en", confidence: 0.99 },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				)
			)
		)

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 2, updated: 2 })
		const updates = db.calls.filter((c) => /UPDATE lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
		expect(updates[0].params).toContain("ko")
		expect(updates[1].params).toContain("en")
		expect(updates[0].sql).toMatch(/language_source/i)
		expect(updates[0].sql).toMatch(/language_detector_version/i)
	})

	it("stamps null language with the current version when confidence is low", async () => {
		const db = createPagedDB([[{ id: 7, lyrics: await compressed("???"), format: "plain" }]])
		const env = buildEnv(db)
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ results: [{ iso6391: "und", confidence: 0.1 }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			)
		)

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 1, updated: 0 })
		const update = db.calls.find((c) => /UPDATE lyrics/i.test(c.sql))
		expect(update).toBeDefined()
		expect(update!.params[0]).toBeNull()
	})

	it("stamps null language and null version when the batch errors", async () => {
		const db = createPagedDB([
			[{ id: 9, lyrics: await compressed("some text some text some text"), format: "plain" }],
		])
		const env = buildEnv(db)
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 1, updated: 0 })
		const update = db.calls.find((c) => /UPDATE lyrics/i.test(c.sql))
		expect(update).toBeDefined()
		expect(update!.params.slice(0, 2)).toEqual([null, null])
	})

	it("stops when a page comes back empty", async () => {
		const db = createPagedDB([
			[{ id: 1, lyrics: await compressed("hello world hello world"), format: "plain" }],
			[],
		])
		const env = buildEnv(db)
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ results: [{ iso6391: "en", confidence: 0.99 }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			)
		)

		const result = await backfillLanguage(env)

		expect(result.scanned).toBe(1)
		const selects = db.calls.filter((c) => /SELECT/i.test(c.sql))
		expect(selects).toHaveLength(2)
	})

	it("bails when every row in a page returns ready: false (service unavailable)", async () => {
		const db = createPagedDB([
			[
				{ id: 1, lyrics: await compressed("hello world hello world"), format: "plain" },
				{ id: 2, lyrics: await compressed("bonjour le monde"), format: "plain" },
			],
			[{ id: 3, lyrics: await compressed("would never be reached"), format: "plain" }],
		])
		const env = buildEnv(db)
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 2, updated: 0 })
		const selects = db.calls.filter((c) => /SELECT/i.test(c.sql))
		expect(selects).toHaveLength(1)
		const updates = db.calls.filter((c) => /UPDATE lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
	})

	it("processes multiple non-empty pages before stopping", async () => {
		const db = createPagedDB([
			[{ id: 1, lyrics: await compressed("hello world hello world"), format: "plain" }],
			[{ id: 2, lyrics: await compressed("bonjour le monde bonjour"), format: "plain" }],
			[],
		])
		const env = buildEnv(db)
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ results: [{ iso6391: "en", confidence: 0.99 }] }),
						{ status: 200, headers: { "content-type": "application/json" } }
					)
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ results: [{ iso6391: "fr", confidence: 0.92 }] }),
						{ status: 200, headers: { "content-type": "application/json" } }
					)
				)
		)

		const result = await backfillLanguage(env)

		expect(result).toEqual({ scanned: 2, updated: 2 })
		const selects = db.calls.filter((c) => /SELECT/i.test(c.sql))
		expect(selects).toHaveLength(3)
		const updates = db.calls.filter((c) => /UPDATE lyrics/i.test(c.sql))
		expect(updates).toHaveLength(2)
		expect(updates[0].params).toContain("en")
		expect(updates[1].params).toContain("fr")
	})
})
