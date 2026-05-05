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
