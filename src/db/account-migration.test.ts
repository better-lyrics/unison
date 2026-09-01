import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { computeMigrationPlan, runMigration } from "./account-migration"

function idx(calls: { sql: string }[], needle: string): number {
	return calls.findIndex((c) => c.sql.includes(needle))
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

function mergeSeed() {
	return [
		{ id: 1 }, // old user
		{ id: 2 }, // new user
		{ discord_id: "disc-old", key_id: "oldkey" }, // old link
		null, // new link
		[
			{ id: 1, key_id: "oldkey" },
			{ id: 2, key_id: "newkey" },
		], // users snapshot
		[
			{ user_id: 1, lyrics_id: 10 },
			{ user_id: 1, lyrics_id: 11 },
			{ user_id: 2, lyrics_id: 11 },
			{ user_id: 2, lyrics_id: 12 },
		], // votes snapshot
		[{ user_id: 2, lyrics_id: 11 }], // reports snapshot (new user has 1)
		[
			{ id: 10, submitter_id: 1, video_id: "vidA" },
			{ id: 20, submitter_id: 2, video_id: "vidB" },
			{ id: 21, submitter_id: 2, video_id: "vidC" },
		], // lyrics snapshot
		[{ submitter_id: 2 }, { submitter_id: 2 }, { submitter_id: 1 }], // fulfillments snapshot
		[{ discord_id: "disc-old", key_id: "oldkey" }], // discord snapshot
		[
			{ requester_id: "oldkey", requester_type: "extension", video_id: "vidA" },
			{ requester_id: "newkey", requester_type: "extension", video_id: "vidA" },
		], // requests snapshot
		{ n: 1 }, // vote collisions
		{ n: 0 }, // report collisions
		{ n: 1 }, // request collisions
	]
}

describe("runMigration (merge case)", () => {
	it("returns moved counts and collisionsDropped from the snapshot and collision queries", async () => {
		const db = makeMockDB(mergeSeed())
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		if ("error" in result) throw new Error(`unexpected error: ${result.error}`)
		expect(result.moved).toEqual({
			submissions: 2,
			votes: 2,
			reports: 1,
			fulfillments: 2,
			collisionsDropped: 2,
		})
	})

	it("captures a snapshot of every touched table", async () => {
		const db = makeMockDB(mergeSeed())
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		if ("error" in result) throw new Error("unexpected error")
		expect(Object.keys(result.snapshot).sort()).toEqual(
			[
				"discord_links",
				"lyrics",
				"lyrics_requests",
				"reports",
				"request_fulfillments",
				"users",
				"votes",
			].sort()
		)
		expect(result.snapshot.users).toHaveLength(2)
		expect(result.snapshot.votes).toHaveLength(4)
	})

	it("reports affected lyrics and video ids for cache busting and score recompute", async () => {
		const db = makeMockDB(mergeSeed())
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		if ("error" in result) throw new Error("unexpected error")
		expect(result.affectedLyricsIds).toEqual(expect.arrayContaining([10, 11, 12, 20, 21]))
		expect(result.affectedVideoIds).toEqual(expect.arrayContaining(["vidA", "vidB", "vidC"]))
	})

	it("dedupes votes/reports before re-pointing, deletes the new user before relabel", async () => {
		const db = makeMockDB(mergeSeed())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		const calls = db.calls
		expect(idx(calls, "DELETE FROM votes")).toBeLessThan(idx(calls, "UPDATE votes SET user_id"))
		expect(idx(calls, "DELETE FROM reports")).toBeLessThan(idx(calls, "UPDATE reports SET user_id"))
		expect(idx(calls, "DELETE FROM users")).toBeLessThan(idx(calls, "UPDATE users SET key_id"))
		expect(idx(calls, "UPDATE users SET key_id")).toBeGreaterThanOrEqual(0)
		expect(idx(calls, "UPDATE discord_links SET key_id")).toBeGreaterThanOrEqual(0)
		expect(idx(calls, "is_self_vote")).toBeGreaterThan(idx(calls, "UPDATE users SET key_id"))
		expect(idx(calls, "avg_vote")).toBeGreaterThan(idx(calls, "is_self_vote"))
	})

	it("regression: lyrics_requests dedup keeps the survivor's (old key) request and drops the new key's dup", async () => {
		const db = makeMockDB(mergeSeed())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		const del = db.calls.find(
			(c) => c.sql.includes("DELETE FROM lyrics_requests") && c.sql.includes("requester_type")
		)
		expect(del).toBeDefined()
		// the delete targets the NEW key's rows (first bound param), keeping the old key's
		expect(del?.params[0]).toBe("newkey")
	})

	it("short-circuits with BOTH_KEYS_LINKED and mutates nothing when both keys hold a discord link", async () => {
		const db = makeMockDB([
			{ id: 1 }, // old user
			{ id: 2 }, // new user
			{ discord_id: "disc-old", key_id: "oldkey" }, // old link
			{ discord_id: "disc-new", key_id: "newkey" }, // new link
		])
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		expect(result).toEqual({ error: "BOTH_KEYS_LINKED" })
		expect(db.calls.some((c) => c.sql.startsWith("UPDATE") || c.sql.startsWith("DELETE"))).toBe(false)
	})

	it("rejects SAME_KEY defensively", async () => {
		const db = makeMockDB([])
		const result = await runMigration(makeEnv(db), { oldKey: "samekey", newKey: "samekey" })
		expect(result).toEqual({ error: "SAME_KEY" })
	})

	it("reports OLD_KEY_NO_USER when the old key has no user row", async () => {
		const db = makeMockDB([null])
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		expect(result).toEqual({ error: "OLD_KEY_NO_USER" })
	})
})

describe("runMigration (relabel case)", () => {
	function relabelSeed() {
		return [
			{ id: 1 }, // old user
			null, // new user (none)
			{ discord_id: "disc-old", key_id: "oldkey" }, // old link
			null, // new link
			[{ id: 1, key_id: "oldkey" }], // users snapshot
			[{ user_id: 1, lyrics_id: 10 }], // votes snapshot
			[], // reports snapshot
			[{ id: 10, submitter_id: 1, video_id: "vidA" }], // lyrics snapshot
			[], // fulfillments snapshot
			[{ discord_id: "disc-old", key_id: "oldkey" }], // discord snapshot
			[{ requester_id: "oldkey", requester_type: "extension", video_id: "vidA" }], // requests snapshot
			{ n: 0 }, // request collisions
		]
	}

	it("does not re-point votes or reports (no colliding user row), but relabels requests and the key", async () => {
		const db = makeMockDB(relabelSeed())
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey" })
		if ("error" in result) throw new Error("unexpected error")
		expect(result.moved).toEqual({
			submissions: 0,
			votes: 0,
			reports: 0,
			fulfillments: 0,
			collisionsDropped: 0,
		})
		expect(db.calls.some((c) => c.sql.includes("UPDATE votes SET user_id"))).toBe(false)
		expect(db.calls.some((c) => c.sql.includes("DELETE FROM users"))).toBe(false)
		expect(idx(db.calls, "UPDATE lyrics_requests SET requester_id")).toBeGreaterThanOrEqual(0)
		expect(idx(db.calls, "UPDATE users SET key_id")).toBeGreaterThanOrEqual(0)
	})
})
