import { config } from "@/config"
import { auditThresholds } from "@/jobs/threshold-audit"
import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"

function histRow(total: number, counts: Partial<Record<number, number>>) {
	const row: Record<string, string> = { total: String(total) }
	for (let k = 2; k <= 10; k++) row[`at_least_${k}`] = String(counts[k] ?? 0)
	return row
}

function makeEnv(scriptedRows: unknown[], cache: Map<string, string>, sqls: string[] = []): Env {
	const queue = [...scriptedRows]
	const db = {
		prepare(sql: string) {
			sqls.push(sql)
			return {
				bind() {
					return this
				},
				async first<T>(): Promise<T | null> {
					return (queue.shift() as T) ?? null
				},
			}
		},
	}
	const cacheAdapter = {
		async get(key: string) {
			return cache.get(key) ?? null
		},
		async put(key: string, value: string) {
			cache.set(key, value)
		},
		async delete(key: string) {
			cache.delete(key)
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cacheAdapter as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
	process.env.NTFY_TOPIC_URL = ""
})

// Five populations in registry order: confidence, proven, autoHideMinVotes,
// autoHideDecisive, reports. Confidence has a drifting shape
// (current 3 -> recommended 4); the rest are empty (no drift).
// cov@3 = 240/600 = 0.40 > target 0.25, and 0.40 - 0.25 = 0.15 > 0.10 tolerance.
function scriptDriftingConfidenceOnly(): unknown[] {
	return [
		histRow(600, { 2: 300, 3: 240, 4: 120, 5: 90, 6: 70, 7: 55, 8: 44, 9: 35, 10: 28 }),
		histRow(0, {}),
		histRow(0, {}),
		histRow(0, {}),
		histRow(0, {}),
	]
}

describe("auditThresholds", () => {
	it("detects drift on confidence and notifies once", async () => {
		process.env.NTFY_TOPIC_URL = "https://ntfy.sh/x"
		const fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const cache = new Map<string, string>()
		const env = makeEnv(scriptDriftingConfidenceOnly(), cache)

		const result = await auditThresholds(env)

		expect(result.checked).toBe(5)
		expect(result.drifted).toContain("minVotesForConfidence")
		expect(result.notified).toBe(true)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(cache.get("audit:lastNotified:minVotesForConfidence")).toBe("4")
	})

	it("dedups: a second identical run does not notify again", async () => {
		process.env.NTFY_TOPIC_URL = "https://ntfy.sh/x"
		const fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)
		const cache = new Map<string, string>([["audit:lastNotified:minVotesForConfidence", "4"]])
		const env = makeEnv(scriptDriftingConfidenceOnly(), cache)

		const result = await auditThresholds(env)

		expect(result.drifted).toContain("minVotesForConfidence")
		expect(result.notified).toBe(false)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("reports no drift when every population is empty", async () => {
		const env = makeEnv(
			[histRow(0, {}), histRow(0, {}), histRow(0, {}), histRow(0, {}), histRow(0, {})],
			new Map()
		)
		const result = await auditThresholds(env)
		expect(result.drifted).toEqual([])
		expect(result.notified).toBe(false)
	})

	it("mirrors the live moderation filters in its population queries", async () => {
		const sqls: string[] = []
		const env = makeEnv(
			[histRow(0, {}), histRow(0, {}), histRow(0, {}), histRow(0, {}), histRow(0, {})],
			new Map(),
			sqls
		)

		await auditThresholds(env)

		const decisive = sqls.find((s) => s.includes("downvotes = vote_count"))
		expect(decisive).toBeDefined()
		expect(decisive).toContain(String(config.moderation.autoHide.decisiveMinAgeDays * 86400))

		const ratio = sqls.find((s) => s.includes("downvotes >="))
		expect(ratio).toBeDefined()
		expect(ratio).toContain(String(config.moderation.autoHide.downvoteRatio))
		expect(ratio).toContain(String(config.moderation.autoHide.maxEffectiveScore))
	})
})
