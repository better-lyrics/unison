import { describe, expect, it } from "vitest"
import { hash32, mulberry32 } from "./seeded-rng"

describe("hash32", () => {
	it("is deterministic for the same string", () => {
		expect(hash32("council")).toBe(hash32("council"))
	})

	it("returns an unsigned 32-bit integer", () => {
		const h = hash32("a".repeat(64))
		expect(Number.isInteger(h)).toBe(true)
		expect(h).toBeGreaterThanOrEqual(0)
		expect(h).toBeLessThanOrEqual(0xffffffff)
	})

	it("separates distinct inputs", () => {
		expect(hash32("seed-a")).not.toBe(hash32("seed-b"))
	})

	describe("edge cases", () => {
		it("handles the empty string", () => {
			expect(hash32("")).toBe(0)
		})

		it("handles unicode without throwing", () => {
			expect(Number.isInteger(hash32("日本語 🎧"))).toBe(true)
		})
	})
})

describe("mulberry32", () => {
	it("produces the same sequence for the same seed", () => {
		const a = mulberry32(12345)
		const b = mulberry32(12345)
		expect([a(), a(), a()]).toEqual([b(), b(), b()])
	})

	it("produces a different sequence for a different seed", () => {
		const a = mulberry32(1)
		const b = mulberry32(2)
		expect(a()).not.toBe(b())
	})

	describe("invariants", () => {
		it("stays in the [0, 1) range", () => {
			const rand = mulberry32(999)
			for (let i = 0; i < 1000; i++) {
				const v = rand()
				expect(v).toBeGreaterThanOrEqual(0)
				expect(v).toBeLessThan(1)
			}
		})
	})
})
