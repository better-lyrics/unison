import type Redis from "ioredis"
import { Logger } from "./logger"

const log = new Logger("cache")

// One script so a counter can never be left without an expiry, which would block its key forever.
const COUNT_IN_WINDOW = `
local count = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) < 0 then
	redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`

export class RedisRateLimiter {
	private redis: Redis
	private maxRequests: number
	private windowSeconds: number

	constructor(redis: Redis, maxRequests = 10, windowSeconds = 60) {
		this.redis = redis
		this.maxRequests = maxRequests
		this.windowSeconds = windowSeconds
	}

	async limit(opts: {
		key: string
		maxRequests?: number
		windowSeconds?: number
	}): Promise<{ success: boolean }> {
		const max = opts.maxRequests ?? this.maxRequests
		const window = opts.windowSeconds ?? this.windowSeconds
		const redisKey = `rl:${opts.key}`
		try {
			const count = Number(await this.redis.eval(COUNT_IN_WINDOW, 1, redisKey, window))
			return { success: count <= max }
		} catch (err) {
			log.warn("rate-limit check failed, allowing request", {
				key: opts.key,
				error: (err as Error).message,
			})
			return { success: true }
		}
	}
}
