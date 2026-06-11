import { describe, expect, it } from "vitest"
import { detectLanguage, extractTtmlLang, mapTo639_1 } from "./detect-language"

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

const ENGLISH_LYRICS = [
	"In your arms I find the answer to every question",
	"You whisper softly and the world begins to spin",
	"Holding on tight to the moments we have together",
	"Every heartbeat is a song that only we can hear",
].join("\n")

const JAPANESE_LYRICS = [
	"あなたの腕の中で答えを見つけた",
	"小さな声で囁いて世界が回り始める",
	"二人の時間をしっかり抱きしめて",
	"鼓動の音は二人だけの歌になる",
].join("\n")

const KOREAN_LYRICS = [
	"네 품 안에서 모든 답을 찾았어",
	"부드러운 속삭임에 세상이 돌기 시작해",
	"우리가 함께한 순간들을 꼭 붙잡고",
	"심장 소리는 우리만의 노래가 되어",
].join("\n")

const ENGLISH_TTML_WITH_LANG = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div><p>${ENGLISH_LYRICS}</p></div></body></tt>`

const ENGLISH_TTML_NO_LANG = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${ENGLISH_LYRICS
	.split("\n")
	.map((line) => `<p>${line}</p>`)
	.join("")}</div></body></tt>`

const ENGLISH_LRC = ENGLISH_LYRICS
	.split("\n")
	.map((line, i) => `[00:${String(i * 5).padStart(2, "0")}.00]${line}`)
	.join("\n")

describe("detectLanguage", () => {
	describe("happy paths", () => {
		it("returns en from TTML xml:lang metadata", () => {
			expect(detectLanguage(ENGLISH_TTML_WITH_LANG, "ttml")).toBe("en")
		})

		it("falls through to detection when TTML root has no xml:lang", () => {
			expect(detectLanguage(ENGLISH_TTML_NO_LANG, "ttml")).toBe("en")
		})

		it("detects Japanese plain lyrics", () => {
			expect(detectLanguage(JAPANESE_LYRICS, "plain")).toBe("ja")
		})

		it("detects Korean plain lyrics", () => {
			expect(detectLanguage(KOREAN_LYRICS, "plain")).toBe("ko")
		})

		it("strips LRC timestamps before detection", () => {
			expect(detectLanguage(ENGLISH_LRC, "lrc")).toBe("en")
		})
	})

	describe("edge cases", () => {
		it("returns null for empty input", () => {
			expect(detectLanguage("", "plain")).toBeNull()
		})

		it("returns null for input shorter than the minimum length", () => {
			expect(detectLanguage("oh oh la", "plain")).toBeNull()
		})

		it("returns null for repetitive non-linguistic input", () => {
			expect(detectLanguage("ooooohhhhhhh ahhhhhhhh ooooohhhhhhh", "plain")).toBeNull()
		})

		it("ignores TTML xml:lang and falls through when it is empty", () => {
			const ttml = `<tt xml:lang=""><body><div><p>${ENGLISH_LYRICS}</p></div></body></tt>`
			expect(detectLanguage(ttml, "ttml")).toBe("en")
		})

		it("accepts a precomputed plainText argument and uses it directly", () => {
			expect(detectLanguage("ignored", "plain", JAPANESE_LYRICS)).toBe("ja")
		})
	})

	describe("invariants", () => {
		it("is deterministic", () => {
			expect(detectLanguage(JAPANESE_LYRICS, "plain")).toBe(
				detectLanguage(JAPANESE_LYRICS, "plain"),
			)
		})

		it("never returns an uppercase code", () => {
			const result = detectLanguage(ENGLISH_LYRICS, "plain")
			expect(result).toBe(result?.toLowerCase())
		})
	})

	describe("regressions", () => {
		it("returns en for representative English lyrics (row 818 motivation)", () => {
			expect(detectLanguage(ENGLISH_LYRICS, "plain")).toBe("en")
		})
	})
})
