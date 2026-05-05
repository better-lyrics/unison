import Redis from "ioredis"

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
		return this.redis.get(key)
	}

	async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
		if (opts?.expirationTtl) {
			await this.redis.setex(key, opts.expirationTtl, value)
		} else {
			await this.redis.set(key, value)
		}
	}

	async delete(key: string): Promise<void> {
		await this.redis.del(key)
	}

	async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
		const result = await this.redis.set(key, value, "EX", ttlSeconds, "NX")
		return result === "OK"
	}
}
