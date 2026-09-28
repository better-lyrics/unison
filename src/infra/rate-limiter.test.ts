import { describe, expect, it } from "vitest"
import { RedisRateLimiter } from "./rate-limiter"

function fakeRedis() {
	const counts = new Map<string, number>()
	const ttls = new Map<string, number>()
	const calls: unknown[][] = []
	return {
		counts,
		ttls,
		calls,
		async eval(script: string, numKeys: number, key: string, window: number) {
			calls.push([script, numKeys, key, window])
			const count = (counts.get(key) ?? 0) + 1
			counts.set(key, count)
			if (!ttls.has(key)) ttls.set(key, Number(window))
			return [count, ttls.get(key)]
		},
	}
}

describe("RedisRateLimiter", () => {
	it("allows requests under the limit", async () => {
		const rl = new RedisRateLimiter(fakeRedis() as never, 3, 60)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(false)
	})

	it("uses opts.maxRequests over the constructor default", async () => {
		const rl = new RedisRateLimiter(fakeRedis() as never, 100, 60)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(true)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(true)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(false)
	})

	it("uses opts.windowSeconds over the constructor default", async () => {
		const redis = fakeRedis()
		await new RedisRateLimiter(redis as never, 10, 60).limit({ key: "k", windowSeconds: 5 })
		expect(redis.ttls.get("rl:k")).toBe(5)
	})

	it("falls back to constructor windowSeconds when opts.windowSeconds is omitted", async () => {
		const redis = fakeRedis()
		await new RedisRateLimiter(redis as never, 10, 60).limit({ key: "k" })
		expect(redis.ttls.get("rl:k")).toBe(60)
	})

	it("counts and arms the expiry in one atomic script call", async () => {
		const redis = fakeRedis()
		await new RedisRateLimiter(redis as never, 10, 60).limit({ key: "k" })
		expect(redis.calls).toHaveLength(1)
		const [script, numKeys, key, window] = redis.calls[0]
		expect(numKeys).toBe(1)
		expect(key).toBe("rl:k")
		expect(window).toBe(60)
		expect(script).toMatch(/INCR/)
		expect(script).toMatch(/TTL/)
		expect(script).toMatch(/EXPIRE/)
	})

	it("reports how long until the window resets", async () => {
		const redis = fakeRedis()
		redis.ttls.set("rl:k", 42)
		const rl = new RedisRateLimiter(redis as never, 10, 60)
		expect(await rl.limit({ key: "k" })).toEqual({ success: true, resetSeconds: 42 })
	})

	describe("error paths", () => {
		it("fails open when redis throws", async () => {
			const broken = {
				eval: async () => {
					throw new Error("ECONNRESET")
				},
			}
			const rl = new RedisRateLimiter(broken as never, 10, 60)
			expect(await rl.limit({ key: "k" })).toEqual({ success: true, resetSeconds: 60 })
		})
	})
})
