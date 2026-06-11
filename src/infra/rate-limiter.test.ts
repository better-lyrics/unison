import { describe, expect, it, vi } from "vitest"
import { RedisRateLimiter } from "./rate-limiter"

describe("RedisRateLimiter", () => {
	it("fails open when redis throws", async () => {
		const broken = {
			incr: vi.fn(async () => {
				throw new Error("ECONNRESET")
			}),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(broken as never, 10, 60)
		expect(await rl.limit({ key: "k" })).toEqual({ success: true })
	})

	it("allows requests under the limit", async () => {
		const counter = { n: 0 }
		const ok = {
			incr: vi.fn(async () => ++counter.n),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(ok as never, 3, 60)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(true)
		expect((await rl.limit({ key: "k" })).success).toBe(false)
	})

	it("uses opts.maxRequests over the constructor default", async () => {
		const counter = { n: 0 }
		const ok = {
			incr: vi.fn(async () => ++counter.n),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(ok as never, 100, 60)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(true)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(true)
		expect((await rl.limit({ key: "k", maxRequests: 2 })).success).toBe(false)
	})

	it("uses opts.windowSeconds over the constructor default on the first hit", async () => {
		const ok = {
			incr: vi.fn(async () => 1),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(ok as never, 10, 60)
		await rl.limit({ key: "k", windowSeconds: 5 })
		expect(ok.expire).toHaveBeenCalledWith("rl:k", 5)
	})

	it("falls back to constructor windowSeconds when opts.windowSeconds is omitted", async () => {
		const ok = {
			incr: vi.fn(async () => 1),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(ok as never, 10, 60)
		await rl.limit({ key: "k" })
		expect(ok.expire).toHaveBeenCalledWith("rl:k", 60)
	})

	it("does not re-arm expire on subsequent hits even with override window", async () => {
		const counter = { n: 0 }
		const ok = {
			incr: vi.fn(async () => ++counter.n),
			expire: vi.fn(),
		}
		const rl = new RedisRateLimiter(ok as never, 10, 60)
		await rl.limit({ key: "k", windowSeconds: 5 })
		await rl.limit({ key: "k", windowSeconds: 5 })
		expect(ok.expire).toHaveBeenCalledTimes(1)
	})
})
