import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { generatePetName } from "@/utils/petname"
import { clearNickname, resolveDisplayName, setNickname } from "./users"

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
							const next = queue.shift()
							if (
								next instanceof Error ||
								(next && typeof next === "object" && "code" in next)
							) {
								throw next
							}
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

function makeRecordingCache() {
	const deleteCalls: string[] = []
	const cache = {
		...makeMockCache(),
		async delete(key: string) {
			deleteCalls.push(key)
		},
	}
	return { cache, deleteCalls }
}

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: object = makeMockCache()
): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

describe("resolveDisplayName", () => {
	it("returns the stored nickname when the user has set one", async () => {
		const db = makeMockDB([{ nickname: "Alex" }])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, "k1")
		expect(result).toBe("Alex")
		expect(db.calls[0].sql).toBe("SELECT nickname FROM users WHERE key_id = ?")
		expect(db.calls[0].params).toEqual(["k1"])
	})

	it("falls back to generatePetName when nickname is null", async () => {
		const keyId = "abcdef0123456789"
		const db = makeMockDB([{ nickname: null }])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, keyId)
		expect(result).toBe(generatePetName(keyId))
		expect(db.calls[0].params).toEqual([keyId])
	})

	it("falls back to generatePetName when no row exists", async () => {
		const keyId = "0011223344556677"
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const result = await resolveDisplayName(env, keyId)
		expect(result).toBe(generatePetName(keyId))
		expect(db.calls[0].params).toEqual([keyId])
	})
})

describe("setNickname", () => {
	it("returns ok:true when the UPDATE succeeds", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const result = await setNickname(env, "k1", "Alex")
		expect(result).toEqual({ ok: true })
		expect(db.calls[0].sql).toBe(
			"UPDATE users SET nickname = ?, nickname_updated_at = ? WHERE key_id = ?"
		)
		expect(db.calls[0].params).toHaveLength(3)
		expect(db.calls[0].params[0]).toBe("Alex")
		expect(typeof db.calls[0].params[1]).toBe("number")
		expect(db.calls[0].params[2]).toBe("k1")
	})

	it("returns ok:false TAKEN when Postgres throws 23505", async () => {
		const db = makeMockDB([{ code: "23505" }])
		const env = makeEnv(db)
		const result = await setNickname(env, "k1", "Alex")
		expect(result).toEqual({ ok: false, reason: "TAKEN" })
	})

	it("rethrows non-23505 errors", async () => {
		const err = Object.assign(new Error("connection lost"), { code: "57P01" })
		const db = makeMockDB([err])
		const env = makeEnv(db)
		await expect(setNickname(env, "k1", "Alex")).rejects.toBe(err)
	})

	it("stamps nickname_updated_at to the current second", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const before = Math.floor(Date.now() / 1000)
		await setNickname(env, "k1", "Alex")
		const after = Math.floor(Date.now() / 1000)
		const stamped = db.calls[0].params[1] as number
		expect(stamped).toBeGreaterThanOrEqual(before)
		expect(stamped).toBeLessThanOrEqual(after + 1)
	})
})

describe("clearNickname", () => {
	it("issues the right UPDATE and resolves", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		await clearNickname(env, "k1")
		expect(db.calls[0].sql).toBe(
			"UPDATE users SET nickname = NULL, nickname_updated_at = ? WHERE key_id = ?"
		)
		expect(db.calls[0].params).toHaveLength(2)
		expect(typeof db.calls[0].params[0]).toBe("number")
		expect(db.calls[0].params[1]).toBe("k1")
	})

	it("stamps nickname_updated_at to the current second", async () => {
		const db = makeMockDB([null])
		const env = makeEnv(db)
		const before = Math.floor(Date.now() / 1000)
		await clearNickname(env, "k1")
		const after = Math.floor(Date.now() / 1000)
		const stamped = db.calls[0].params[0] as number
		expect(stamped).toBeGreaterThanOrEqual(before)
		expect(stamped).toBeLessThanOrEqual(after + 1)
	})
})

describe("nickname mutations invalidate the per-video lyrics cache", () => {
	it("setNickname success path deletes v:<videoId> for each of the user's submissions", async () => {
		const db = makeMockDB([null, [{ video_id: "vA" }, { video_id: "vB" }]])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		const result = await setNickname(env, "k1", "Alex")

		expect(result).toEqual({ ok: true })
		expect(deleteCalls).toContain("v:vA")
		expect(deleteCalls).toContain("v:vB")
		expect(db.calls[0].sql).toMatch(/^UPDATE users SET nickname/)
		expect(db.calls[1].sql).toMatch(/SELECT\s+DISTINCT\s+l\.video_id/i)
		expect(db.calls[1].params).toEqual(["k1"])
	})

	it("setNickname TAKEN path does not run the SELECT or invalidate any key", async () => {
		const db = makeMockDB([{ code: "23505" }])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		const result = await setNickname(env, "k1", "Alex")

		expect(result).toEqual({ ok: false, reason: "TAKEN" })
		expect(deleteCalls).toEqual([])
		expect(db.calls).toHaveLength(1)
	})

	it("setNickname success with no submissions still runs the SELECT", async () => {
		const db = makeMockDB([null, []])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await setNickname(env, "k1", "Alex")

		expect(deleteCalls.filter((k) => k.startsWith("v:"))).toEqual([])
		expect(db.calls).toHaveLength(2)
	})

	it("setNickname runs the UPDATE before the SELECT", async () => {
		const db = makeMockDB([null, [{ video_id: "vA" }]])
		const { cache } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await setNickname(env, "k1", "Alex")

		expect(db.calls[0].sql).toMatch(/^UPDATE users/)
		expect(db.calls[1].sql).toMatch(/^SELECT DISTINCT/)
	})

	it("clearNickname deletes v:<videoId> for each of the user's submissions", async () => {
		const db = makeMockDB([null, [{ video_id: "vX" }]])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await clearNickname(env, "k1")

		expect(deleteCalls).toContain("v:vX")
		expect(db.calls[0].sql).toMatch(/^UPDATE users SET nickname = NULL/)
		expect(db.calls[1].sql).toMatch(/SELECT\s+DISTINCT\s+l\.video_id/i)
	})

	it("clearNickname with no submissions runs the SELECT", async () => {
		const db = makeMockDB([null, []])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await clearNickname(env, "k1")

		expect(deleteCalls.filter((k) => k.startsWith("v:"))).toEqual([])
		expect(db.calls).toHaveLength(2)
	})

	it("regression: stale submitter_nickname is evicted from v:<videoId> when nickname mutates", async () => {
		const db = makeMockDB([null, [{ video_id: "stale-video-1" }]])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await setNickname(env, "k1", "NewName")

		expect(deleteCalls).toContain("v:stale-video-1")
	})

	it("setNickname success path evicts the curator leaderboard cache", async () => {
		const db = makeMockDB([null, []])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await setNickname(env, "k1", "Alex")

		expect(deleteCalls).toContain("leaderboard:users")
	})

	it("setNickname TAKEN path does not evict the curator leaderboard cache", async () => {
		const db = makeMockDB([{ code: "23505" }])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await setNickname(env, "k1", "Alex")

		expect(deleteCalls).not.toContain("leaderboard:users")
	})

	it("clearNickname evicts the curator leaderboard cache", async () => {
		const db = makeMockDB([null, []])
		const { cache, deleteCalls } = makeRecordingCache()
		const env = makeEnv(db, cache)

		await clearNickname(env, "k1")

		expect(deleteCalls).toContain("leaderboard:users")
	})
})
