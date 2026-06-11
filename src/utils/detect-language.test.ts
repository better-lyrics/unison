import { describe, expect, it } from "vitest"
import { extractTtmlLang, mapTo639_1 } from "./detect-language"

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

describe("extractTtmlLang", () => {
	describe("happy paths", () => {
		it("returns the base language tag from xml:lang on the root tt", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div><p>hello</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBe("en")
		})

		it("lowercases the language tag", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="EN"><body><div><p>hello</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBe("en")
		})

		it("strips a script subtag and returns only the base language", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="zh-Hant"><body><div><p>你好</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBe("zh")
		})

		it("strips a region subtag and returns only the base language", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="pt-BR"><body><div><p>olá</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBe("pt")
		})
	})

	describe("edge cases", () => {
		it("returns null when root tt has no xml:lang", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>hello</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBeNull()
		})

		it("returns null when xml:lang is empty", () => {
			const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang=""><body><div><p>hi</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBeNull()
		})

		it("returns null when the input is not valid XML", () => {
			expect(extractTtmlLang("not xml at all")).toBeNull()
		})

		it("returns null when the root is not tt", () => {
			const xml = `<root xml:lang="en"><body/></root>`
			expect(extractTtmlLang(xml)).toBeNull()
		})
	})

	describe("invariants", () => {
		it("is deterministic", () => {
			const ttml = `<tt xml:lang="ja"><body><div><p>x</p></div></body></tt>`
			expect(extractTtmlLang(ttml)).toBe(extractTtmlLang(ttml))
		})
	})
})
