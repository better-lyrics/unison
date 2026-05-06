import { describe, expect, it, vi } from "vitest"
import { KVCompat } from "./cache"

function mockRedis() {
	const store = new Map<string, string>()
	return {
		set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
			const nx = args.includes("NX")
			if (nx && store.has(key)) return null
			store.set(key, value)
			return "OK"
		}),
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		setex: vi.fn(),
		del: vi.fn(),
		scan: vi.fn(async (cursor: string, _match: string, pattern: string) => {
			if (cursor !== "0") return ["0", []]
			const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)
			return ["0", [...store.keys()].filter((k) => re.test(k))]
		}),
		store,
	}
}

describe("KVCompat.setNX", () => {
	it("returns true when key is new", async () => {
		const kv = new KVCompat(mockRedis() as never)
		expect(await kv.setNX("k", "v", 60)).toBe(true)
	})

	it("returns false when key already exists", async () => {
		const redis = mockRedis()
		const kv = new KVCompat(redis as never)
		await kv.setNX("k", "v", 60)
		expect(await kv.setNX("k", "v", 60)).toBe(false)
	})
})

describe("KVCompat resilience", () => {
	const broken = (method: string) => ({
		[method]: vi.fn(async () => {
			throw new Error("ECONNRESET")
		}),
	})

	it("get returns null when redis throws", async () => {
		const kv = new KVCompat(broken("get") as never)
		expect(await kv.get("k")).toBeNull()
	})

	it("put swallows errors", async () => {
		const kv = new KVCompat(broken("setex") as never)
		await expect(kv.put("k", "v", { expirationTtl: 60 })).resolves.toBeUndefined()
	})

	it("delete swallows errors", async () => {
		const kv = new KVCompat(broken("del") as never)
		await expect(kv.delete("k")).resolves.toBeUndefined()
	})

	it("setNX returns true (fail-open) when redis throws", async () => {
		const kv = new KVCompat(broken("set") as never)
		expect(await kv.setNX("k", "v", 60)).toBe(true)
	})

	it("keys returns [] when redis throws", async () => {
		const kv = new KVCompat(broken("scan") as never)
		expect(await kv.keys("foo:*")).toEqual([])
	})
})

describe("KVCompat.keys", () => {
	it("returns matching keys via SCAN", async () => {
		const redis = mockRedis()
		redis.store.set("feed:global:20", "x")
		redis.store.set("feed:global:50", "y")
		redis.store.set("v:abc", "z")
		const kv = new KVCompat(redis as never)
		const result = await kv.keys("feed:global:*")
		expect(result.sort()).toEqual(["feed:global:20", "feed:global:50"])
	})
})
