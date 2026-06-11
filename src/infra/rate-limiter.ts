import type Redis from "ioredis"
import { Logger } from "./logger"

const log = new Logger("cache")

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
			const count = await this.redis.incr(redisKey)
			if (count === 1) {
				await this.redis.expire(redisKey, window)
			}
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
