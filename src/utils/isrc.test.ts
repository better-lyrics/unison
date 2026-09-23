import { describe, expect, it } from "vitest"
import { normalizeIsrc } from "./isrc"

describe("normalizeIsrc", () => {
	it("accepts a canonical ISRC", () => {
		expect(normalizeIsrc("USRC17607839")).toBe("USRC17607839")
	})

	it("uppercases and strips hyphens and spaces", () => {
		expect(normalizeIsrc("us-rc1-76-07839")).toBe("USRC17607839")
		expect(normalizeIsrc(" GB AYE 04 00001 ")).toBe("GBAYE0400001")
	})

	describe("edge cases", () => {
		it("rejects empty and whitespace-only input", () => {
			expect(normalizeIsrc("")).toBeNull()
			expect(normalizeIsrc("   ")).toBeNull()
		})

		it("rejects the wrong length", () => {
			expect(normalizeIsrc("USRC1760783")).toBeNull()
			expect(normalizeIsrc("USRC176078390")).toBeNull()
		})

		it("rejects letters in the designation code", () => {
			expect(normalizeIsrc("USRC1760783X")).toBeNull()
		})

		it("folds fullwidth characters", () => {
			expect(normalizeIsrc("ＵＳＲＣ１７６０７８３９")).toBe("USRC17607839")
		})
	})

	describe("invariants", () => {
		it("is idempotent", () => {
			const once = normalizeIsrc("us-rc1-76-07839")
			expect(once && normalizeIsrc(once)).toBe(once)
		})
	})
})
