import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { createSession, deleteSession, generateSessionToken, getSession } from "./session"

function makeMockCache() {
	const store = new Map<string, { value: string; ttl: number }>()
	return {
		store,
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
		async setNX() {
			return true
		},
	}
}

function makeEnv(cache: ReturnType<typeof makeMockCache>): Env {
	return {
		DB: {} as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

describe("generateSessionToken", () => {
	it("produces URL-safe tokens of stable minimum length", () => {
		const tok = generateSessionToken()
		expect(tok.length).toBeGreaterThanOrEqual(32)
		expect(tok).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it("produces unique tokens across calls", () => {
		const seen = new Set<string>()
		for (let i = 0; i < 100; i++) seen.add(generateSessionToken())
		expect(seen.size).toBe(100)
	})
})

describe("createSession", () => {
	it("stores keyId + timestamps under session:<token> with the configured TTL", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const keyId = "a".repeat(64)
		const { token, expiresAt } = await createSession(env, keyId)
		expect(token.length).toBeGreaterThanOrEqual(32)
		const entry = cache.store.get(`session:${token}`)
		expect(entry).toBeDefined()
		const parsed = JSON.parse(entry!.value) as { keyId: string; expiresAt: number }
		expect(parsed.keyId).toBe(keyId)
		expect(parsed.expiresAt).toBe(expiresAt)
		expect(entry!.ttl).toBe(30 * 24 * 60 * 60)
	})
})

describe("getSession", () => {
	it("returns the stored record for a live token", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const keyId = "b".repeat(64)
		const { token } = await createSession(env, keyId)
		const record = await getSession(env, token)
		expect(record?.keyId).toBe(keyId)
	})

	it("returns null for an unknown token", async () => {
		const env = makeEnv(makeMockCache())
		expect(await getSession(env, "nope")).toBeNull()
	})

	it("returns null when stored value is corrupt", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		cache.store.set("session:bad", { value: "{not json", ttl: 0 })
		expect(await getSession(env, "bad")).toBeNull()
	})
})

describe("deleteSession", () => {
	it("removes the stored token", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const { token } = await createSession(env, "c".repeat(64))
		await deleteSession(env, token)
		expect(await getSession(env, token)).toBeNull()
	})
})
