import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { backfillVoteCounts } from "./backfill-vote-counts"

function createMockDB(queue: unknown[]) {
	const calls: { sql: string; params: unknown[] }[] = []
	const db = {
		prepare(sql: string) {
			let params: unknown[] = []
			return {
				bind(...args: unknown[]) {
					params = args
					return this
				},
				async first<T>(): Promise<T | null> {
					calls.push({ sql, params })
					return (queue.shift() as T) ?? null
				},
				async run(): Promise<void> {
					calls.push({ sql, params })
				},
			}
		},
	}
	return { db: db as unknown as Env["DB"], calls }
}

describe("backfillVoteCounts", () => {
	it("does nothing and issues no UPDATE when no rows have drifted", async () => {
		const { db, calls } = createMockDB([{ n: 0 }])

		const result = await backfillVoteCounts({ DB: db } as unknown as Env)

		expect(result.repaired).toBe(0)
		expect(calls.some((c) => c.sql.includes("UPDATE lyrics"))).toBe(false)
	})

	it("recomputes upvotes and downvotes from the votes table when rows have drifted", async () => {
		const { db, calls } = createMockDB([{ n: 7 }])

		const result = await backfillVoteCounts({ DB: db } as unknown as Env)

		expect(result.repaired).toBe(7)
		const update = calls.find((c) => c.sql.includes("UPDATE lyrics"))
		expect(update).toBeDefined()
		expect(update?.sql).toMatch(/upvotes\s*=\s*\(SELECT COUNT/i)
		expect(update?.sql).toMatch(/v\.vote\s*=\s*1/)
		expect(update?.sql).toMatch(/v\.vote\s*=\s*-1/)
	})

	describe("edge cases", () => {
		it("coerces a bigint-style count string to a number", async () => {
			const { db } = createMockDB([{ n: "42" }])

			const result = await backfillVoteCounts({ DB: db } as unknown as Env)

			expect(result.repaired).toBe(42)
		})

		it("treats a missing count row as zero drift", async () => {
			const { db, calls } = createMockDB([null])

			const result = await backfillVoteCounts({ DB: db } as unknown as Env)

			expect(result.repaired).toBe(0)
			expect(calls.some((c) => c.sql.includes("UPDATE lyrics"))).toBe(false)
		})
	})
})
