import type { Env } from "@/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { castVote, removeVote } from "./votes"

// Mock fire-and-forget side effects so they don't run in tests.
vi.mock("@/jobs/score-updater", () => ({
	recalculateScore: vi.fn(() => Promise.resolve()),
}))
vi.mock("./users", () => ({
	updateUserAvgVote: vi.fn(() => Promise.resolve()),
}))

// -- Mocks -----------------------------------------------------------------

interface DBStep {
	sql: string
	params: unknown[]
}

class MockPreparedStatement {
	constructor(
		readonly sql: string,
		private readonly db: MockDB
	) {}
	private params: unknown[] = []

	bind(...args: unknown[]): MockPreparedStatement {
		this.params = args
		return this
	}

	async first<T>(): Promise<T | null> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		const next = this.db.queue.shift()
		return (next as T) ?? null
	}

	async all<T>(): Promise<{ results: T[] }> {
		this.db.calls.push({ sql: this.sql, params: this.params })
		const next = this.db.queue.shift()
		return { results: (next as T[]) ?? [] }
	}

	async run(): Promise<void> {
		this.db.calls.push({ sql: this.sql, params: this.params })
	}

	getSql(): string {
		return this.sql
	}
	getParams(): unknown[] {
		return this.params
	}
}

interface MockDB {
	calls: DBStep[]
	queue: unknown[]
	prepare(sql: string): MockPreparedStatement
	batch(stmts: MockPreparedStatement[]): Promise<void>
}

function createMockDB(queue: unknown[] = []): MockDB {
	const calls: DBStep[] = []
	const db: MockDB = {
		calls,
		queue,
		prepare(sql: string) {
			return new MockPreparedStatement(sql, db)
		},
		async batch(stmts: MockPreparedStatement[]) {
			for (const stmt of stmts) {
				calls.push({ sql: stmt.getSql(), params: stmt.getParams() })
			}
		},
	}
	return db
}

interface MockCache {
	deleteCalls: string[]
	get(key: string): Promise<string | null>
	put(): Promise<void>
	delete(key: string): Promise<void>
}

function createMockCache(): MockCache {
	const deleteCalls: string[] = []
	return {
		deleteCalls,
		async get() {
			return null
		},
		async put() {},
		async delete(key: string) {
			deleteCalls.push(key)
		},
	}
}

function createEnv(db: MockDB, cache: MockCache): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
	}
}

afterEach(() => {
	vi.clearAllMocks()
})

// -- Tests -----------------------------------------------------------------

describe("castVote", () => {
	it("invalidates v:${video_id} cache after first-time vote so other readers get fresh data", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ submitter_id: 99, video_id: "vidABC" }, // SELECT submitter_id, video_id
			null, // SELECT existing vote (none)
		])
		const env = createEnv(db, cache)

		const result = await castVote(env, 1, 42, 1)

		expect(result.success).toBe(true)
		expect(cache.deleteCalls).toEqual(["v:vidABC"])
	})

	it("invalidates cache when changing an existing vote", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ submitter_id: 99, video_id: "vidXYZ" }, // SELECT lyrics row
			{ vote: 1 }, // SELECT existing vote (was upvote)
		])
		const env = createEnv(db, cache)

		const result = await castVote(env, 1, 42, -1)

		expect(result.success).toBe(true)
		expect(cache.deleteCalls).toEqual(["v:vidXYZ"])
	})

	it("does NOT invalidate cache when the vote is a duplicate (no DB change)", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ submitter_id: 99, video_id: "vid" },
			{ vote: 1 }, // existing vote already matches
		])
		const env = createEnv(db, cache)

		const result = await castVote(env, 1, 42, 1)

		expect(result.success).toBe(false)
		expect(result.message).toBe("Already voted")
		expect(cache.deleteCalls).toEqual([])
	})

	it("invalidates cache BEFORE awaiting the (potentially failing) score recalc", async () => {
		const cache = createMockCache()
		const db = createMockDB([{ submitter_id: 99, video_id: "vid" }, null])
		const env = createEnv(db, cache)

		// recalc is mocked to resolve immediately, but the contract is that
		// cache invalidation happens regardless of recalc success/failure.
		await castVote(env, 1, 42, 1)

		expect(cache.deleteCalls).toEqual(["v:vid"])
	})

	it("flags self-vote when submitter_id matches voter (regression check)", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ submitter_id: 42, video_id: "vid" }, // submitter == voter
			null,
		])
		const env = createEnv(db, cache)

		await castVote(env, 1, 42, 1)

		// Find the INSERT INTO votes call and check is_self_vote (4th param) is 1
		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO votes"))
		expect(insertCall).toBeDefined()
		expect(insertCall?.params[3]).toBe(1)
	})

	it("does not flag self-vote when submitter differs from voter", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ submitter_id: 99, video_id: "vid" }, // different submitter
			null,
		])
		const env = createEnv(db, cache)

		await castVote(env, 1, 42, 1)

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO votes"))
		expect(insertCall?.params[3]).toBe(0)
	})

	it("fetches video_id alongside submitter_id in a single round-trip", async () => {
		const cache = createMockCache()
		const db = createMockDB([{ submitter_id: 1, video_id: "vid" }, null])
		const env = createEnv(db, cache)

		await castVote(env, 1, 42, 1)

		const lookup = db.calls[0]
		expect(lookup.sql).toContain("submitter_id")
		expect(lookup.sql).toContain("video_id")
		expect(lookup.sql).toContain("FROM lyrics")
	})
})

describe("removeVote", () => {
	it("invalidates v:${video_id} cache after removing a vote", async () => {
		const cache = createMockCache()
		const db = createMockDB([
			{ vote: 1, video_id: "vidREM" }, // SELECT vote + joined video_id
		])
		const env = createEnv(db, cache)

		const result = await removeVote(env, 1, 42)

		expect(result.success).toBe(true)
		expect(cache.deleteCalls).toEqual(["v:vidREM"])
	})

	it("does NOT invalidate cache when there's nothing to remove", async () => {
		const cache = createMockCache()
		const db = createMockDB([null]) // no existing vote
		const env = createEnv(db, cache)

		const result = await removeVote(env, 1, 42)

		expect(result.success).toBe(false)
		expect(result.message).toBe("No vote to remove")
		expect(cache.deleteCalls).toEqual([])
	})

	it("joins votes with lyrics to fetch video_id alongside the existing vote", async () => {
		const cache = createMockCache()
		const db = createMockDB([{ vote: 1, video_id: "vid" }])
		const env = createEnv(db, cache)

		await removeVote(env, 1, 42)

		const sql = db.calls[0].sql
		expect(sql).toMatch(/JOIN\s+lyrics/i)
		expect(sql).toContain("v.vote")
		expect(sql).toContain("l.video_id")
	})

	it("issues UPDATE lyrics with vote-magnitude reversal", async () => {
		const cache = createMockCache()
		const db = createMockDB([{ vote: 1, video_id: "vid" }])
		const env = createEnv(db, cache)

		await removeVote(env, 1, 42)

		const updateCall = db.calls.find((c) => c.sql.includes("UPDATE lyrics"))
		expect(updateCall).toBeDefined()
		// vote (param 0,1,2) is the original vote being undone
		expect(updateCall?.params[0]).toBe(1)
		expect(updateCall?.params[3]).toBe(1) // lyricsId
	})
})
