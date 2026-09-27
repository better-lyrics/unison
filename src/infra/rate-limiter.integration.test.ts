import { randomUUID } from "node:crypto"
import Redis from "ioredis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { RedisRateLimiter } from "./rate-limiter"

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("RedisRateLimiter (integration)", () => {
	const url = process.env.INTEGRATION_REDIS_URL ?? process.env.REDIS_URL
	let redis: Redis
	const prefix = `test:${randomUUID()}`
	const key = (name: string) => `${prefix}:${name}`

	beforeAll(() => {
		if (!url) throw new Error("INTEGRATION_REDIS_URL or REDIS_URL is required")
		redis = new Redis(url)
	})

	afterAll(async () => {
		const leftovers = await redis.keys(`rl:${prefix}:*`)
		if (leftovers.length > 0) await redis.del(...leftovers)
		redis.disconnect()
	})

	it("arms the window expiry on the first hit", async () => {
		const rl = new RedisRateLimiter(redis, 3, 60)
		expect(await rl.limit({ key: key("first") })).toEqual({ success: true })
		const ttl = await redis.ttl(`rl:${key("first")}`)
		expect(ttl).toBeGreaterThan(0)
		expect(ttl).toBeLessThanOrEqual(60)
	})

	it("enforces the limit within the window", async () => {
		const rl = new RedisRateLimiter(redis, 2, 60)
		const results = []
		for (let i = 0; i < 3; i++) results.push((await rl.limit({ key: key("limit") })).success)
		expect(results).toEqual([true, true, false])
	})

	it("keeps a fixed window instead of extending it on later hits", async () => {
		const rl = new RedisRateLimiter(redis, 10, 60)
		await rl.limit({ key: key("fixed") })
		await redis.pexpire(`rl:${key("fixed")}`, 30_000)
		await rl.limit({ key: key("fixed") })
		expect(await redis.pttl(`rl:${key("fixed")}`)).toBeLessThanOrEqual(30_000)
	})

	describe("regressions", () => {
		it("regression: a counter left without an expiry gets one on the next hit", async () => {
			await redis.set(`rl:${key("stuck")}`, "500")
			expect(await redis.ttl(`rl:${key("stuck")}`)).toBe(-1)

			const rl = new RedisRateLimiter(redis, 300, 60)
			expect(await rl.limit({ key: key("stuck") })).toEqual({ success: false })
			const ttl = await redis.ttl(`rl:${key("stuck")}`)
			expect(ttl).toBeGreaterThan(0)
			expect(ttl).toBeLessThanOrEqual(60)
		})
	})
})
