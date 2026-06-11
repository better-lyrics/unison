import { describe, expect, it } from "vitest"
import { mapTo639_1 } from "./detect-language"

describe("mapTo639_1", () => {
	describe("happy paths", () => {
		it("maps eng to en", () => {
			expect(mapTo639_1("eng")).toBe("en")
		})

		it("maps jpn to ja", () => {
			expect(mapTo639_1("jpn")).toBe("ja")
		})

		it("maps cmn (Mandarin) to zh", () => {
			expect(mapTo639_1("cmn")).toBe("zh")
		})

		it("maps kor to ko", () => {
			expect(mapTo639_1("kor")).toBe("ko")
		})

		it("maps spa to es", () => {
			expect(mapTo639_1("spa")).toBe("es")
		})
	})

	describe("edge cases", () => {
		it("returns null for the franc 'und' marker", () => {
			expect(mapTo639_1("und")).toBeNull()
		})

		it("returns null for empty string", () => {
			expect(mapTo639_1("")).toBeNull()
		})

		it("returns the 639-3 code as-is when no 639-1 mapping exists", () => {
			// xxx is a private-use code with no ISO 639-1 form.
			expect(mapTo639_1("xxx")).toBe("xxx")
		})
	})

	describe("invariants", () => {
		it("is deterministic", () => {
			expect(mapTo639_1("eng")).toBe(mapTo639_1("eng"))
		})
	})
})
