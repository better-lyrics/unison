import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import {
	computeMigrationPlan,
	createPreviewAudit,
	getAudit,
	markAuditFailed,
	restoreFromSnapshot,
	runMigration,
} from "./account-migration"

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

	it("relabel case: counts the old identity's holdings; new key has no user", async () => {
		const db = makeMockDB([
			{ id: 1, nickname: "oldnick" }, // old user
			null, // new user (none)
			{ n: 2 }, // OLD submissions
			{ n: 2 }, // OLD votes
			{ n: 0 }, // OLD reports
			{ n: 0 }, // OLD fulfillments
			{ n: 2 }, // request collisions
		])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		expect(result).toEqual({
			oldUserId: 1,
			newUserId: null,
			oldNickname: "oldnick",
			newNickname: null,
			counts: { submissions: 2, votes: 2, reports: 0, fulfillments: 0, collisions: 2 },
		})
	})

	it("merge case: counts the old identity's holdings, collisions, and both nicknames", async () => {
		const db = makeMockDB([
			{ id: 1, nickname: "oldnick" }, // old user
			{ id: 2, nickname: "newnick" }, // new user
			{ n: 5 }, // OLD submissions
			{ n: 9 }, // OLD votes
			{ n: 1 }, // OLD reports
			{ n: 2 }, // OLD fulfillments
			{ n: 3 }, // vote collisions
			{ n: 1 }, // report collisions
			{ n: 4 }, // request collisions
		])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		expect(result).toEqual({
			oldUserId: 1,
			newUserId: 2,
			oldNickname: "oldnick",
			newNickname: "newnick",
			counts: { submissions: 5, votes: 9, reports: 1, fulfillments: 2, collisions: 3 + 1 + 4 },
		})
	})

	it("regression: counts reflect the OLD identity's holdings, not the new key's", async () => {
		const db = makeMockDB([
			{ id: 52188, nickname: "gwuhbruh" }, // old user: 2 submissions, 2 votes
			{ id: 53466, nickname: "runner_66" }, // new user: 0 submissions, 1 vote
			{ n: 2 }, // OLD submissions
			{ n: 2 }, // OLD votes
			{ n: 0 }, // OLD reports
			{ n: 0 }, // OLD fulfillments
			{ n: 0 }, // vote collisions
			{ n: 0 }, // report collisions
			{ n: 0 }, // request collisions
		])
		const result = await computeMigrationPlan(makeEnv(db), "oldkey", "newkey")
		if ("error" in result) throw new Error("unexpected error")
		expect(result.counts).toEqual({
			submissions: 2,
			votes: 2,
			reports: 0,
			fulfillments: 0,
			collisions: 0,
		})
		const subCall = db.calls.find((c) => c.sql.includes("FROM lyrics WHERE submitter_id"))
		expect(subCall?.params).toEqual([52188])
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

function mergeSeed(): unknown[] {
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
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
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
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
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
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
		if ("error" in result) throw new Error("unexpected error")
		expect(result.affectedLyricsIds).toEqual(expect.arrayContaining([10, 11, 12, 20, 21]))
		expect(result.affectedVideoIds).toEqual(expect.arrayContaining(["vidA", "vidB", "vidC"]))
	})

	it("dedupes votes/reports before re-pointing, deletes the new user before relabel", async () => {
		const db = makeMockDB(mergeSeed())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
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
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
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
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
		expect(result).toEqual({ error: "BOTH_KEYS_LINKED" })
		expect(db.calls.some((c) => c.sql.startsWith("UPDATE") || c.sql.startsWith("DELETE"))).toBe(false)
	})

	it("rejects SAME_KEY defensively", async () => {
		const db = makeMockDB([])
		const result = await runMigration(makeEnv(db), {
			oldKey: "samekey",
			newKey: "samekey",
			migrationId: 7,
		})
		expect(result).toEqual({ error: "SAME_KEY" })
	})

	it("reports OLD_KEY_NO_USER when the old key has no user row", async () => {
		const db = makeMockDB([null])
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
		expect(result).toEqual({ error: "OLD_KEY_NO_USER" })
	})
})

describe("runMigration nickname handling", () => {
	function seedWithNewNickname() {
		const seed = mergeSeed()
		seed[4] = [
			{ id: 1, key_id: "oldkey", nickname: "oldnick" },
			{ id: 2, key_id: "newkey", nickname: "newnick" },
		]
		return seed
	}

	it("keeps the survivor's nickname by default (no nickname update)", async () => {
		const db = makeMockDB(seedWithNewNickname())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
		expect(db.calls.some((c) => c.sql.includes("UPDATE users SET nickname"))).toBe(false)
	})

	it("applies the new key's nickname to the survivor when keepNickname is 'new'", async () => {
		const db = makeMockDB(seedWithNewNickname())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", keepNickname: "new", migrationId: 7 })
		const call = db.calls.find((c) => c.sql.includes("UPDATE users SET nickname"))
		expect(call).toBeDefined()
		expect(call?.params[0]).toBe("newnick")
		expect(call?.params[call.params.length - 1]).toBe(1) // survivor id
		// nickname is applied only after the new user row is deleted (frees the unique nickname_lower)
		expect(idx(db.calls, "DELETE FROM users")).toBeLessThan(idx(db.calls, "UPDATE users SET nickname"))
	})

	it("falls back to the old nickname when keepNickname is 'new' but the new key has none", async () => {
		const seed = mergeSeed()
		seed[4] = [
			{ id: 1, key_id: "oldkey", nickname: "oldnick" },
			{ id: 2, key_id: "newkey", nickname: null },
		]
		const db = makeMockDB(seed)
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", keepNickname: "new", migrationId: 7 })
		expect(db.calls.some((c) => c.sql.includes("UPDATE users SET nickname"))).toBe(false)
	})
})

describe("runMigration audit", () => {
	it("writes the committed audit row inside the migration transaction", async () => {
		const db = makeMockDB(mergeSeed())
		await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
		const auditUpdate = db.calls.find(
			(c) => c.sql.includes("UPDATE migration_requests") && c.sql.includes("status = 'committed'")
		)
		expect(auditUpdate).toBeDefined()
		expect(auditUpdate?.params[auditUpdate.params.length - 1]).toBe(7)
		expect(
			auditUpdate?.params.some((p) => typeof p === "string" && p.includes('"users"'))
		).toBe(true)
	})

	it("does not write a committed audit row on an error short-circuit", async () => {
		const db = makeMockDB([null]) // old user missing
		const result = await runMigration(makeEnv(db), {
			oldKey: "oldkey",
			newKey: "newkey",
			migrationId: 7,
		})
		expect(result).toEqual({ error: "OLD_KEY_NO_USER" })
		expect(db.calls.some((c) => c.sql.includes("UPDATE migration_requests"))).toBe(false)
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
		const result = await runMigration(makeEnv(db), { oldKey: "oldkey", newKey: "newkey", migrationId: 7 })
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

	it("regression: does not count null-submitter lyrics (deleted-by rows) as moved submissions", async () => {
		const db = makeMockDB([
			{ id: 1 }, // old user
			null, // new user (relabel case)
			{ discord_id: "disc-old", key_id: "oldkey" }, // old link
			null, // new link
			[{ id: 1, key_id: "oldkey" }], // users snapshot
			[], // votes snapshot
			[], // reports snapshot
			[{ id: 99, submitter_id: null, video_id: "vidX" }], // lyrics snapshot: pulled in via deleted_by_user_id
			[], // fulfillments snapshot
			[{ discord_id: "disc-old", key_id: "oldkey" }], // discord snapshot
			[], // requests snapshot
			{ n: 0 }, // request collisions
		])
		const result = await runMigration(makeEnv(db), {
			oldKey: "oldkey",
			newKey: "newkey",
			migrationId: 7,
		})
		if ("error" in result) throw new Error("unexpected error")
		expect(result.moved.submissions).toBe(0)
	})
})

describe("migration audit", () => {
	it("createPreviewAudit inserts a preview row with projected counts and returns its id", async () => {
		const db = makeMockDB([{ id: 42 }])
		const id = await createPreviewAudit(makeEnv(db), {
			sessionId: "sess-1",
			discordId: "disc-1",
			oldKey: "oldkey",
			newKey: "newkey",
			counts: { submissions: 5, votes: 9, reports: 1, fulfillments: 2, collisions: 3 },
		})
		expect(id).toBe(42)
		const insert = db.calls[0]
		expect(insert.sql).toContain("INSERT INTO migration_requests")
		expect(insert.sql).toContain("'preview'")
		expect(insert.sql).toContain("RETURNING id")
		expect(insert.params).toEqual(["sess-1", "disc-1", "oldkey", "newkey", 5, 9, 1, 2, 3])
	})

	it("markAuditFailed records the error and failed status", async () => {
		const db = makeMockDB([])
		await markAuditFailed(makeEnv(db), 42, "boom")
		const update = db.calls[0]
		expect(update.sql).toContain("status = 'failed'")
		expect(update.sql).toContain("status <> 'committed'")
		expect(update.params).toEqual(["boom", 42])
	})

	it("getAudit selects the row by id", async () => {
		const db = makeMockDB([{ id: 42, status: "committed" }])
		const row = await getAudit(makeEnv(db), 42)
		expect(row).toEqual({ id: 42, status: "committed" })
		expect(db.calls[0].sql).toContain("FROM migration_requests")
	})
})

function committedAuditRow() {
	return {
		id: 7,
		status: "committed",
		old_key: "oldkey",
		new_key: "newkey",
		snapshot: {
			users: [
				{
					id: 1,
					key_id: "oldkey",
					reputation: 1.2,
					vote_count: 5,
					avg_vote: 0.4,
					created_at: 100,
					nickname: "old",
					nickname_updated_at: 90,
				},
				{
					id: 2,
					key_id: "newkey",
					reputation: 1.0,
					vote_count: 2,
					avg_vote: 0.0,
					created_at: 200,
					nickname: null,
					nickname_updated_at: null,
				},
			],
			votes: [{ id: 11, lyrics_id: 10, user_id: 1, vote: 1, is_self_vote: 0, created_at: 100 }],
			reports: [],
			lyrics: [{ id: 10, submitter_id: 1, deleted_by_user_id: null, video_id: "vidA" }],
			request_fulfillments: [{ id: 5, submitter_id: 1 }],
			discord_links: [
				{ discord_id: "disc-old", key_id: "oldkey", discord_username: "u", linked_at: 100 },
			],
			lyrics_requests: [
				{
					id: 3,
					video_id: "vidA",
					requester_id: "oldkey",
					requester_type: "extension",
					weight: 1.0,
					created_at: 100,
				},
			],
		},
	}
}

describe("restoreFromSnapshot", () => {
	it("returns NOT_FOUND when the audit row is missing", async () => {
		const db = makeMockDB([null])
		expect(await restoreFromSnapshot(makeEnv(db), 999)).toEqual({ error: "NOT_FOUND" })
	})

	it("refuses to restore a non-committed migration", async () => {
		const db = makeMockDB([{ id: 7, status: "preview", old_key: "o", new_key: "n", snapshot: {} }])
		expect(await restoreFromSnapshot(makeEnv(db), 7)).toEqual({ error: "NOT_COMMITTED" })
	})

	it("refuses and mutates nothing when the survivor has interim activity after commit", async () => {
		const db = makeMockDB([
			committedAuditRow(), // getAudit
			[{ id: 11 }, { id: 999 }], // current votes: snapshot's 11 + interim 999
			// current reports all() -> [] from the empty queue
		])
		const result = await restoreFromSnapshot(makeEnv(db), 7)
		expect(result).toEqual({ error: "HAS_INTERIM_ACTIVITY" })
		expect(
			db.calls.some(
				(c) =>
					c.sql.startsWith("DELETE") || c.sql.startsWith("UPDATE") || c.sql.startsWith("INSERT")
			)
		).toBe(false)
	})

	it("reverses the migration: survivor first, new user re-inserted, leaf tables delete+reinsert, lyrics updated", async () => {
		const db = makeMockDB([committedAuditRow()])
		const result = await restoreFromSnapshot(makeEnv(db), 7)
		expect(result).toEqual({ restored: true })

		const calls = db.calls
		expect(idx(calls, "UPDATE users SET key_id")).toBeLessThan(idx(calls, "INSERT INTO users"))
		expect(idx(calls, "DELETE FROM votes")).toBeLessThan(idx(calls, "INSERT INTO votes"))
		expect(idx(calls, "DELETE FROM discord_links")).toBeLessThan(
			idx(calls, "INSERT INTO discord_links")
		)
		// lyrics restored by targeted UPDATE, never deleted (would cascade its votes/reports)
		expect(calls.some((c) => c.sql.includes("DELETE FROM lyrics "))).toBe(false)
		expect(idx(calls, "UPDATE lyrics SET submitter_id")).toBeGreaterThanOrEqual(0)
	})
})
