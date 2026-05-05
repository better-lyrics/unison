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
})
