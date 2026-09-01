import { describe, expect, it } from "vitest"
import { shortKeyId } from "./short-key-id"

describe("shortKeyId", () => {
	it("returns the last 6 chars of a 64-hex key", () => {
		const key = `${"a".repeat(58)}abc123`
		expect(shortKeyId(key)).toBe("abc123")
	})

	it("returns the whole string when shorter than 6", () => {
		expect(shortKeyId("abc")).toBe("abc")
	})

	it("returns an empty string for an empty key", () => {
		expect(shortKeyId("")).toBe("")
	})
})
