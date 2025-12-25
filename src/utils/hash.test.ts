import { describe, expect, it } from "vitest"
import { hashDeviceId, hashIP } from "./hash"

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

describe("hashDeviceId", () => {
	it("returns consistent hash for same device ID", () => {
		const hash1 = hashDeviceId("device-uuid-12345")
		const hash2 = hashDeviceId("device-uuid-12345")
		expect(hash1).toBe(hash2)
	})

	it("returns different hash for different device IDs", () => {
		const hash1 = hashDeviceId("device-uuid-12345")
		const hash2 = hashDeviceId("device-uuid-67890")
		expect(hash1).not.toBe(hash2)
	})

	it("returns base36 string", () => {
		const hash = hashDeviceId("test-device-id")
		expect(hash).toMatch(/^[0-9a-z]+$/)
	})

	it("produces different hashes than hashIP for same input", () => {
		const input = "same-input"
		const ipHash = hashIP(input)
		const deviceHash = hashDeviceId(input)
		expect(ipHash).not.toBe(deviceHash)
	})

	it("handles long device IDs", () => {
		const longId = "a".repeat(1000)
		const hash = hashDeviceId(longId)
		expect(hash).toMatch(/^[0-9a-z]+$/)
	})

	it("handles special characters", () => {
		const hash = hashDeviceId("device-id-with-special-chars-!@#$%")
		expect(hash).toMatch(/^[0-9a-z]+$/)
	})

	it("handles UUID format", () => {
		const uuid = "550e8400-e29b-41d4-a716-446655440000"
		const hash = hashDeviceId(uuid)
		expect(hash).toMatch(/^[0-9a-z]+$/)
		expect(hash.length).toBeGreaterThan(0)
	})
})
