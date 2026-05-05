import Redis from "ioredis"
import { Logger } from "./logger"

const log = new Logger("cache")

let redis: Redis | null = null

export function getRedis(redisUrl: string): Redis {
	if (!redis) {
		redis = new Redis(redisUrl)
		redis.on("error", (err) => {
			console.error("redis connection error", err.message)
		})
	}
	return redis
}

export async function closeRedis(): Promise<void> {
	if (redis) {
		redis.disconnect()
		redis = null
	}
}

export class KVCompat {
	private redis: Redis

	constructor(redis: Redis) {
		this.redis = redis
	}

	async get(key: string): Promise<string | null> {
		try {
			return await this.redis.get(key)
		} catch (err) {
			log.warn("cache get failed", { key, error: (err as Error).message })
			return null
		}
	}

	async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
		try {
			if (opts?.expirationTtl) {
				await this.redis.setex(key, opts.expirationTtl, value)
			} else {
				await this.redis.set(key, value)
			}
		} catch (err) {
			log.warn("cache put failed", { key, error: (err as Error).message })
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.redis.del(key)
		} catch (err) {
			log.warn("cache delete failed", { key, error: (err as Error).message })
		}
	}

	// Fail-open: brief Redis outages disable nonce replay protection,
	// but the ±5min timestamp window in isTimestampFresh is the secondary defense.
	async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
		try {
			const result = await this.redis.set(key, value, "EX", ttlSeconds, "NX")
			return result === "OK"
		} catch (err) {
			log.warn("cache setNX failed, allowing request", {
				key,
				error: (err as Error).message,
			})
			return true
		}
	}
}
