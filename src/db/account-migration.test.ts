import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { computeMigrationPlan } from "./account-migration"

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
						getSql: () => sql,
						getParams: () => args,
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
		async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
			return fn(db)
		},
	}
	return db
}

function makeEnv(db: ReturnType<typeof makeMockDB>): Env {
	return { DB: db as unknown as Env["DB"] } as unknown as Env
}

describe("computeMigrationPlan", () => {
	it("reports OLD_KEY_NO_USER when the old key has no users row", async () => {
		const db = makeMockDB([null])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		expect(result).toEqual({ error: "OLD_KEY_NO_USER" })
	})

	it("relabel case: new key has no user, only request collisions can be non-zero", async () => {
		const db = makeMockDB([
			{ id: 1 }, // old user
			null, // new user (none)
			{ n: 2 }, // request collisions
		])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		expect(result).toEqual({
			oldUserId: 1,
			newUserId: null,
			counts: { submissions: 0, votes: 0, reports: 0, fulfillments: 0, collisions: 2 },
		})
	})

	it("merge case: projects moved counts and total collisions", async () => {
		const db = makeMockDB([
			{ id: 1 }, // old user
			{ id: 2 }, // new user
			{ n: 5 }, // submissions on new user
			{ n: 9 }, // votes on new user
			{ n: 1 }, // reports on new user
			{ n: 2 }, // fulfillments on new user
			{ n: 3 }, // vote collisions
			{ n: 1 }, // report collisions
			{ n: 4 }, // request collisions
		])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		expect(result).toEqual({
			oldUserId: 1,
			newUserId: 2,
			counts: { submissions: 5, votes: 9, reports: 1, fulfillments: 2, collisions: 3 + 1 + 4 },
		})
	})

	it("scopes request collisions to extension requesters and the collision subquery", async () => {
		const db = makeMockDB([{ id: 1 }, { id: 2 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }])
		await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		const reqCall = db.calls.find(
			(c) => c.sql.includes("lyrics_requests") && c.sql.toLowerCase().includes("count")
		)
		expect(reqCall?.sql).toContain("requester_type = 'extension'")
		const voteCollision = db.calls.find(
			(c) => c.sql.includes("votes") && c.sql.includes("lyrics_id IN (SELECT lyrics_id FROM votes")
		)
		expect(voteCollision).toBeDefined()
	})
})
