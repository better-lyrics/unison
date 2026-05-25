import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { getLastVoteAt, getSubmissionsByUser } from "./profile"

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
	}
	return db
}

function makeMockCache() {
	return {
		async get() {
			return null
		},
		async put() {},
		async delete() {},
		async keys() {
			return []
		},
		async setNX() {
			return true
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: makeMockCache() as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
	}
}

describe("getLastVoteAt", () => {
	it("returns the timestamp when the user has voted", async () => {
		const db = makeMockDB([{ last_vote_at: 1700000123 }])
		const env = makeEnv(db)
		const result = await getLastVoteAt(env, "k1")
		expect(result).toBe(1700000123)
		expect(db.calls[0].params).toEqual(["k1"])
	})

	it("returns null when the user has no votes", async () => {
		const db = makeMockDB([{ last_vote_at: null }])
		const env = makeEnv(db)
		const result = await getLastVoteAt(env, "k1")
		expect(result).toBeNull()
	})

	it("returns null when the row itself is null", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const result = await getLastVoteAt(env, "kmissing")
		expect(result).toBeNull()
	})
})

describe("getSubmissionsByUser", () => {
	it("maps DB rows to camelCase submission rows", async () => {
		const db = makeMockDB([
			[
				{
					id: 1,
					video_id: "v1",
					song: "Song",
					artist: "Artist",
					album: "Album",
					duration: 200,
					format: "lrc",
					sync_type: "linesync",
					language: "en",
					effective_score: 3.5,
					vote_count: 4,
					confidence: "medium",
					created_at: 1700000111,
					hidden: false,
				},
				{
					id: 2,
					video_id: "v2",
					song: "S2",
					artist: "A2",
					album: null,
					duration: 180,
					format: "plain",
					sync_type: "plain",
					language: null,
					effective_score: 1.0,
					vote_count: 1,
					confidence: "low",
					created_at: 1700000100,
					hidden: true,
				},
			],
		])
		const env = makeEnv(db)
		const result = await getSubmissionsByUser(env, "k1", 21, null)
		expect(result.length).toBe(2)
		expect(result[0]).toMatchObject({
			id: 1,
			videoId: "v1",
			song: "Song",
			artist: "Artist",
			album: "Album",
			duration: 200,
			format: "lrc",
			syncType: "linesync",
			language: "en",
			effectiveScore: 3.5,
			voteCount: 4,
			confidence: "medium",
			createdAt: 1700000111,
			hidden: false,
		})
		expect(result[1].album).toBeNull()
		expect(result[1].language).toBeNull()
		expect(result[1].hidden).toBe(true)
		expect(db.calls[0].params).toEqual(["k1", 21])
	})

	it("returns an empty array when there are no submissions", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		const result = await getSubmissionsByUser(env, "unknown", 21, null)
		expect(result).toEqual([])
	})

	it("passes the cursor as a created_at upper bound when provided", async () => {
		const db = makeMockDB([[]])
		const env = makeEnv(db)
		await getSubmissionsByUser(env, "k1", 21, 1700000050)
		expect(db.calls[0].params).toEqual(["k1", 1700000050, 21])
		expect(db.calls[0].sql).toContain("l.created_at < ?")
	})
})
