import type Redis from "ioredis"
import { Logger } from "./logger"

const log = new Logger("cache")

// One script so a counter can never be left without an expiry, which would block its key forever.
const COUNT_IN_WINDOW = `
local count = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) < 0 then
	redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return { count, redis.call("TTL", KEYS[1]) }
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
	}): Promise<{ success: boolean; resetSeconds: number }> {
		const max = opts.maxRequests ?? this.maxRequests
		const window = opts.windowSeconds ?? this.windowSeconds
		const redisKey = `rl:${opts.key}`
		try {
			const [count, ttl] = (await this.redis.eval(COUNT_IN_WINDOW, 1, redisKey, window)) as [
				number,
				number,
			]
			return { success: Number(count) <= max, resetSeconds: Number(ttl) }
		} catch (err) {
			log.warn("rate-limit check failed, allowing request", {
				key: opts.key,
				error: (err as Error).message,
			})
			return { success: true, resetSeconds: window }
		}
	}
}
