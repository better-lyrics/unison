import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { resyncVoteCounts } from "./resync-vote-counts"

function createMockDB(drifted: { id: number }[]) {
	const calls: { sql: string; params: unknown[] }[] = []
	const db = {
		prepare(sql: string) {
			let params: unknown[] = []
			return {
				bind(...args: unknown[]) {
					params = args
					return this
				},
				async all<T>(): Promise<{ results: T[] }> {
					calls.push({ sql, params })
					return { results: (calls.length === 1 ? drifted : []) as T[] }
				},
				async first<T>(): Promise<T | null> {
					calls.push({ sql, params })
					return null
				},
				async run(): Promise<void> {
					calls.push({ sql, params })
				},
			}
		},
	}
	return { db: db as unknown as Env["DB"], calls }
}

describe("resyncVoteCounts", () => {
	it("does nothing when no live rows have drifted", async () => {
		const { db, calls } = createMockDB([])

		const result = await resyncVoteCounts({ DB: db } as unknown as Env)

		expect(result.repaired).toBe(0)
		expect(calls).toHaveLength(1)
	})

	it("recalculates every drifted live row through recalculateScore", async () => {
		const { db, calls } = createMockDB([{ id: 3 }, { id: 9 }])

		const result = await resyncVoteCounts({ DB: db } as unknown as Env)

		expect(result.repaired).toBe(2)
		const recalculated = calls.filter((c) => c.sql.includes("FROM lyrics l WHERE l.id = ?"))
		expect(recalculated.map((c) => c.params[0])).toEqual([3, 9])
	})
})
