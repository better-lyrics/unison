import { describe, expect, it } from "vitest"
import { hashIP, sha256Hex } from "./hash"

describe("hashIP", () => {
	it("returns consistent hash for same IP", () => {
		const hash1 = hashIP("192.168.1.1")
		const hash2 = hashIP("192.168.1.1")
		expect(hash1).toBe(hash2)
	})

	it("returns different hash for different IPs", () => {
		const hash1 = hashIP("192.168.1.1")
		const hash2 = hashIP("192.168.1.2")
		expect(hash1).not.toBe(hash2)
	})

	it("returns base36 string", () => {
		const hash = hashIP("192.168.1.1")
		expect(hash).toMatch(/^[0-9a-z]+$/)
	})

	it("handles empty string", () => {
		const hash = hashIP("")
		expect(hash).toBe("0")
	})
})

describe("sha256Hex", () => {
	it("matches the standard test vector", () => {
		expect(sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
		)
	})

	describe("edge cases", () => {
		it("hashes the empty string", () => {
			expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
		})

		it("hashes exact code points without normalizing", () => {
			expect(sha256Hex("\u00e9")).not.toBe(sha256Hex("e\u0301"))
		})
	})

	describe("invariants", () => {
		it("is deterministic and 64 hex characters", () => {
			expect(sha256Hex("line one\nline two")).toBe(sha256Hex("line one\nline two"))
			expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/)
		})
	})
})
