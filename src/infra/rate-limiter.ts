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

	async limit(opts: { key: string }): Promise<{ success: boolean }> {
		const redisKey = `rl:${opts.key}`
		try {
			const count = await this.redis.incr(redisKey)
			if (count === 1) {
				await this.redis.expire(redisKey, this.windowSeconds)
			}
			return { success: count <= this.maxRequests }
		} catch (err) {
			log.warn("rate-limit check failed, allowing request", {
				key: opts.key,
				error: (err as Error).message,
			})
			return { success: true }
		}
	}
}
