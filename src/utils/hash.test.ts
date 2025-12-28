import { describe, expect, it } from "vitest"
import { hashIP } from "./hash"

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
