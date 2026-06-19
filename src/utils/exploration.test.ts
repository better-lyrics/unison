import { config } from "@/config"
import type { Confidence } from "@/types"
import { describe, expect, it } from "vitest"
import { allowedSyncTiers, epsilonForTier, hashBucket, hashSeed, selectArm } from "./exploration"

describe("hashBucket", () => {
	it("is always in [0, 1)", () => {
		for (let i = 0; i < 1000; i++) {
			const bucket = hashBucket(`key-${i}`, `video-${i % 37}`)
			expect(bucket).toBeGreaterThanOrEqual(0)
			expect(bucket).toBeLessThan(1)
		}
	})

	it("is deterministic for identical inputs", () => {
		expect(hashBucket("abc", "xyz")).toBe(hashBucket("abc", "xyz"))
		expect(hashBucket("user-1", "dQw4w9WgXcQ")).toBe(hashBucket("user-1", "dQw4w9WgXcQ"))
	})

	it("changes when keyId changes", () => {
		expect(hashBucket("key-a", "video-1")).not.toBe(hashBucket("key-b", "video-1"))
	})

	it("changes when videoId changes", () => {
		expect(hashBucket("key-a", "video-1")).not.toBe(hashBucket("key-a", "video-2"))
	})

	it("spreads across multiple deciles", () => {
		const deciles = new Set<number>()
		for (let i = 0; i < 1000; i++) {
			const bucket = hashBucket(`spread-${i}`, "dQw4w9WgXcQ")
			deciles.add(Math.floor(bucket * 10))
		}
		expect(deciles.size).toBeGreaterThan(1)
	})
})

describe("hashSeed", () => {
	it("returns an unsigned 32-bit integer", () => {
		for (let i = 0; i < 1000; i++) {
			const seed = hashSeed(`key-${i}`, `video-${i}`)
			expect(Number.isInteger(seed)).toBe(true)
			expect(seed).toBeGreaterThanOrEqual(0)
			expect(seed).toBeLessThanOrEqual(0xffffffff)
		}
	})

	it("is deterministic for identical inputs", () => {
		expect(hashSeed("abc", "xyz")).toBe(hashSeed("abc", "xyz"))
	})

	it("agrees with hashBucket on the same key", () => {
		expect(hashSeed("user-1", "video-1") / 0x100000000).toBe(hashBucket("user-1", "video-1"))
	})
})

describe("epsilonForTier", () => {
	it("maps low to the configured low epsilon", () => {
		expect(epsilonForTier("low")).toBe(config.exploration.epsilon.low)
	})

	it("maps medium to the configured medium epsilon", () => {
		expect(epsilonForTier("medium")).toBe(config.exploration.epsilon.medium)
	})

	it("maps high to the configured high epsilon", () => {
		expect(epsilonForTier("high")).toBe(config.exploration.epsilon.high)
	})
})

describe("allowedSyncTiers", () => {
	it("never downgrades a richsync incumbent", () => {
		const tiers = allowedSyncTiers("richsync")
		expect(tiers).toEqual(new Set(["richsync"]))
	})

	it("allows linesync to be replaced by linesync or richsync", () => {
		const tiers = allowedSyncTiers("linesync")
		expect(tiers).toEqual(new Set(["linesync", "richsync"]))
	})

	it("allows plain to be replaced by any sync type", () => {
		const tiers = allowedSyncTiers("plain")
		expect(tiers).toEqual(new Set(["plain", "linesync", "richsync"]))
	})
})

describe("selectArm", () => {
	it("returns a member of the pool", () => {
		const arms = [
			{ id: "a", upvotes: 2, downvotes: 1 },
			{ id: "b", upvotes: 5, downvotes: 0 },
			{ id: "c", upvotes: 0, downvotes: 3 },
		]
		const chosen = selectArm(arms, hashSeed("user-1", "video-1"))
		expect(arms).toContain(chosen)
	})

	it("returns the single arm for a one-element pool", () => {
		const arms = [{ id: "only", upvotes: 0, downvotes: 0 }]
		expect(selectArm(arms, 12345)).toBe(arms[0])
	})

	it("exploits a strongly upvoted arm over a downvoted one", () => {
		const arms = [
			{ id: "good", upvotes: 9, downvotes: 0 },
			{ id: "bad", upvotes: 0, downvotes: 9 },
		]
		let goodCount = 0
		for (let seed = 0; seed < 500; seed++) {
			if (selectArm(arms, seed).id === "good") goodCount++
		}
		expect(goodCount).toBeGreaterThan(450)
	})
})

describe("edge cases", () => {
	it("epsilonForTier returns 0 for an out-of-union value", () => {
		expect(epsilonForTier("bogus" as Confidence)).toBe(0)
	})

	it("selectArm throws on an empty pool", () => {
		expect(() => selectArm([], 1)).toThrow("selectArm: empty pool")
	})

	it("hashBucket handles empty strings", () => {
		const bucket = hashBucket("", "")
		expect(bucket).toBeGreaterThanOrEqual(0)
		expect(bucket).toBeLessThan(1)
	})

	it("selectArm handles all-zero-vote arms without crashing", () => {
		const arms = [
			{ id: "a", upvotes: 0, downvotes: 0 },
			{ id: "b", upvotes: 0, downvotes: 0 },
		]
		expect(arms).toContain(selectArm(arms, 7))
	})
})

describe("invariants", () => {
	it("allowedSyncTiers for richsync never contains plain or linesync", () => {
		const tiers = allowedSyncTiers("richsync")
		expect(tiers.has("plain")).toBe(false)
		expect(tiers.has("linesync")).toBe(false)
	})

	it("selectArm is deterministic per (arms, seed)", () => {
		const arms = [
			{ id: "a", upvotes: 3, downvotes: 2 },
			{ id: "b", upvotes: 1, downvotes: 4 },
			{ id: "c", upvotes: 6, downvotes: 1 },
		]
		expect(selectArm(arms, 99)).toBe(selectArm(arms, 99))
	})

	it("selectArm does not mutate the input array", () => {
		const arms = [
			{ id: "a", upvotes: 1, downvotes: 0 },
			{ id: "b", upvotes: 0, downvotes: 1 },
			{ id: "c", upvotes: 2, downvotes: 2 },
		]
		const snapshot = [...arms]
		selectArm(arms, 42)
		expect(arms).toEqual(snapshot)
		expect(arms[0].id).toBe("a")
		expect(arms[1].id).toBe("b")
		expect(arms[2].id).toBe("c")
	})

	it("selectArm explores more than one distinct arm when all votes are zero", () => {
		const arms = [
			{ id: "a", upvotes: 0, downvotes: 0 },
			{ id: "b", upvotes: 0, downvotes: 0 },
			{ id: "c", upvotes: 0, downvotes: 0 },
		]
		const picked = new Set<string>()
		for (let seed = 0; seed < 200; seed++) {
			picked.add(selectArm(arms, seed).id)
		}
		expect(picked.size).toBeGreaterThan(1)
	})
})

describe("regressions", () => {
	it("selectArm never produces NaN or Infinity theta across a wide seed sweep", () => {
		const arms = [
			{ id: "a", upvotes: 0, downvotes: 0 },
			{ id: "b", upvotes: 100, downvotes: 0 },
			{ id: "c", upvotes: 0, downvotes: 100 },
		]
		for (let seed = 0; seed < 2000; seed++) {
			const chosen = selectArm(arms, seed)
			expect(arms).toContain(chosen)
		}
	})

	it("selectArm guards uniforms into (0, 1] so ln never sees zero", () => {
		const arms = [
			{ id: "a", upvotes: 0, downvotes: 0 },
			{ id: "b", upvotes: 0, downvotes: 0 },
		]
		for (let seed = 0; seed < 100; seed++) {
			expect(arms).toContain(selectArm(arms, seed))
		}
	})
})
