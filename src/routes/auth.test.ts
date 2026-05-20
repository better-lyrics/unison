import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { authRoutes } from "./auth"

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map<string, { value: string; ttl: number }>()
	for (const [k, v] of Object.entries(seed)) store.set(k, { value: v, ttl: 0 })
	const setNXKeys: string[] = []
	return {
		store,
		setNXKeys,
		async get(key: string) {
			return store.get(key)?.value ?? null
		},
		async put(key: string, value: string, opts?: { expirationTtl?: number }) {
			store.set(key, { value, ttl: opts?.expirationTtl ?? 0 })
		},
		async delete(key: string) {
			store.delete(key)
		},
		async keys() {
			return Array.from(store.keys())
		},
		async setNX(key: string, _value: string, _ttl: number) {
			setNXKeys.push(key)
			if (store.has(key)) return false
			store.set(key, { value: _value, ttl: _ttl })
			return true
		},
	}
}

function makeEnv(cache: ReturnType<typeof makeMockCache>): Env & {
	cache: ReturnType<typeof makeMockCache>
} {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: {} as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		cache,
	}
}

describe("GET /auth/challenge", () => {
	it("returns a fresh nonce and stores it with the challenge TTL", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const res = await app.handle(new Request("http://localhost/auth/challenge"))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			success: boolean
			data: { nonce: string; expiresAt: number }
		}
		expect(json.success).toBe(true)
		expect(json.data.nonce.length).toBeGreaterThanOrEqual(16)
		const entry = cache.store.get(`challenge:${json.data.nonce}`)
		expect(entry).toBeDefined()
		expect(entry!.ttl).toBe(5 * 60)
		const nowSec = Math.floor(Date.now() / 1000)
		expect(json.data.expiresAt).toBeGreaterThanOrEqual(nowSec + 5 * 60 - 2)
		expect(json.data.expiresAt).toBeLessThanOrEqual(nowSec + 5 * 60 + 2)
	})

	it("produces unique nonces across calls", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const app = authRoutes(env)
		const nonces = new Set<string>()
		for (let i = 0; i < 5; i++) {
			const res = await app.handle(new Request("http://localhost/auth/challenge"))
			const json = (await res.json()) as { data: { nonce: string } }
			nonces.add(json.data.nonce)
		}
		expect(nonces.size).toBe(5)
	})
})
