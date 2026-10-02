import { describe, expect, it } from "vitest"
import { isCuratedLanguage, isLanguageCode, normalizeLanguage } from "./language-code"

describe("isLanguageCode", () => {
	it("accepts every curated code, including script-tagged ones", () => {
		for (const code of ["en", "hi", "zh", "zh-Hant", "fil"]) expect(isLanguageCode(code)).toBe(true)
	})

	it("accepts a canonical language outside the curated list", () => {
		expect(isLanguageCode("bgc")).toBe(true)
		expect(isLanguageCode("yue")).toBe(true)
		expect(isLanguageCode("bho")).toBe(true)
	})
})

describe("edge cases", () => {
	it("rejects empty, whitespace and garbage", () => {
		for (const code of ["", " ", "xx", "qqq", "not a code", "123"])
			expect(isLanguageCode(code)).toBe(false)
	})

	it("rejects codes that are not in canonical form", () => {
		expect(isLanguageCode("BGC")).toBe(false)
		expect(isLanguageCode(" bgc")).toBe(false)
	})

	it("rejects non-curated region and script variants", () => {
		for (const code of ["pt-BR", "hi-IN", "pa-Arab", "bgc-IN"])
			expect(isLanguageCode(code)).toBe(false)
	})

	it("rejects special and private-use codes", () => {
		for (const code of ["und", "mul", "zxx", "mis", "qaa"]) expect(isLanguageCode(code)).toBe(false)
	})
})

describe("regressions", () => {
	it("rejects alias codes that canonicalize onto a curated language", () => {
		for (const code of ["cmn", "hin", "arb", "iw", "in", "tl", "pes", "zsm"])
			expect(isLanguageCode(code)).toBe(false)
	})
})

describe("regressions: written standards of a curated language", () => {
	it("rejects Bokmål and Nynorsk, which Norwegian already covers", () => {
		expect(isLanguageCode("nb")).toBe(false)
		expect(isLanguageCode("nn")).toBe(false)
		expect(isLanguageCode("no")).toBe(true)
	})
})

describe("isCuratedLanguage", () => {
	it("is true only for the curated list", () => {
		expect(isCuratedLanguage("hi")).toBe(true)
		expect(isCuratedLanguage("bgc")).toBe(false)
	})
})

describe("normalizeLanguage", () => {
	it("keeps a valid code unchanged", () => {
		for (const code of ["en", "zh-Hant", "bgc", "yue"]) expect(normalizeLanguage(code)).toBe(code)
	})

	it("drops regions and resolves aliases onto a stored code", () => {
		const cases: [string, string][] = [
			["en-US", "en"],
			["EN", "en"],
			["pt_BR", "pt"],
			["zh-TW", "zh-Hant"],
			["zh-Hant-HK", "zh-Hant"],
			["zh-Hans", "zh"],
			["zh-CN", "zh"],
			["iw", "he"],
			["tl", "fil"],
			["cmn", "zh"],
			["hin", "hi"],
			["nb", "no"],
			["nn-NO", "no"],
			["bgc-IN", "bgc"],
			["sr-Cyrl", "sr"],
		]
		for (const [tag, code] of cases) expect(normalizeLanguage(tag), tag).toBe(code)
	})

	it("returns null for what no stored code represents", () => {
		for (const tag of ["", "  ", "xx", "und", "zxx", "ja-Latn", "pa-Arab", "not a language"]) {
			expect(normalizeLanguage(tag), tag).toBeNull()
		}
	})

	it("is idempotent", () => {
		for (const tag of ["en-US", "zh-TW", "nb", "bgc-IN"]) {
			const once = normalizeLanguage(tag)
			expect(once && normalizeLanguage(once)).toBe(once)
		}
	})

	it("only ever returns codes isLanguageCode accepts", () => {
		for (const tag of ["en-US", "zh-TW", "iw", "nb", "bgc-IN", "yue-HK"]) {
			expect(isLanguageCode(normalizeLanguage(tag) ?? "")).toBe(true)
		}
	})
})
