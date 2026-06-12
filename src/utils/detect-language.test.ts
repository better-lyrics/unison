import { describe, expect, it } from "vitest"
import {
	DETECTOR_VERSION,
	detectByScript,
	detectLanguage,
	extractTtmlLang,
	mapTo639_1,
} from "./detect-language"

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

		it("returns null when no 639-1 mapping exists (Scots)", () => {
			expect(mapTo639_1("sco")).toBeNull()
		})

		it("returns null for unmapped 3-letter input (snk / Sangu)", () => {
			expect(mapTo639_1("snk")).toBeNull()
		})

		it("returns null for unmapped private-use code", () => {
			expect(mapTo639_1("xxx")).toBeNull()
		})

		it("returns null for Malay individual code without 639-1", () => {
			expect(mapTo639_1("zlm")).toBeNull()
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

describe("detectByScript", () => {
	describe("direct script-to-language mappings", () => {
		it("returns ko for Hangul-dominant text", () => {
			const text = "네 품 안에서 모든 답을 찾았어 부드러운 속삭임에 세상이 돌기 시작해"
			expect(detectByScript(text)).toEqual({ directLanguage: "ko" })
		})

		it("returns ko for Hangul mixed with Latin filler (K-pop)", () => {
			const text =
				"Yeah baby 네 품 안에서 모든 답을 찾았어 부드러운 속삭임에 세상이 돌기 시작해 oh yeah"
			expect(detectByScript(text)).toEqual({ directLanguage: "ko" })
		})

		it("returns ja for any kana presence (Hiragana)", () => {
			const text = "Yeah baby あなたの腕の中で答えを見つけた oh yeah"
			expect(detectByScript(text)).toEqual({ directLanguage: "ja" })
		})

		it("returns ja for Katakana", () => {
			const text = "ラブストーリー is what they call it"
			expect(detectByScript(text)).toEqual({ directLanguage: "ja" })
		})

		it("returns he for Hebrew-dominant text", () => {
			const text = "אני מעיל בארון תלוי על קולב מתעורר משנתי עם קיצו של הסתיו"
			expect(detectByScript(text)).toEqual({ directLanguage: "he" })
		})

		it("returns te for Telugu-dominant text", () => {
			const text = "నీ ప్రేమే నా జీవితం పాట"
			expect(detectByScript(text)).toEqual({ directLanguage: "te" })
		})

		it("returns th for Thai-dominant text", () => {
			const text = "ฉันรักเธอด้วยใจทั้งหมดของฉัน"
			expect(detectByScript(text)).toEqual({ directLanguage: "th" })
		})

		it("returns el for Greek-dominant text", () => {
			const text = "Σε αγαπώ πιο πολύ από οτιδήποτε άλλο στον κόσμο"
			expect(detectByScript(text)).toEqual({ directLanguage: "el" })
		})
	})

	describe("multi-language script restrictions", () => {
		it("restricts to Cyrillic candidates for Russian", () => {
			const text = "Я улыбаюсь как еблан не знаю что ей ответить"
			const hint = detectByScript(text)
			expect(hint.restrictTo).toBeDefined()
			expect(hint.restrictTo).toContain("rus")
			expect(hint.restrictTo).toContain("ukr")
			expect(hint.directLanguage).toBeUndefined()
		})

		it("restricts to Han candidates for Chinese", () => {
			const text = "我爱你比任何其他东西在这个世界上"
			const hint = detectByScript(text)
			expect(hint.restrictTo).toBeDefined()
			expect(hint.restrictTo).toContain("cmn")
		})

		it("restricts to Arabic candidates", () => {
			const text = "أحبك أكثر من أي شيء آخر في العالم"
			const hint = detectByScript(text)
			expect(hint.restrictTo).toContain("arb")
		})
	})

	describe("Latin-only and empty", () => {
		it("returns empty hint for Latin-only English text", () => {
			expect(detectByScript("Hello world this is plain english text")).toEqual({})
		})

		it("returns empty hint for empty input", () => {
			expect(detectByScript("")).toEqual({})
		})

		it("returns empty hint for whitespace and punctuation only", () => {
			expect(detectByScript("  ... !! ??  ")).toEqual({})
		})

		it("returns empty hint when non-Latin presence is below the 20% threshold", () => {
			const text = "This is a long english sentence with one stray Korean char 안 included"
			expect(detectByScript(text)).toEqual({})
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

const KOREAN_WITH_ENGLISH_FILLER = [
	"Yeah baby uh-huh",
	"네 품 안에서 모든 답을 찾았어",
	"부드러운 속삭임에 세상이 돌기 시작해",
	"oh oh yeah I love you",
	"우리가 함께한 순간들을 꼭 붙잡고",
	"심장 소리는 우리만의 노래가 되어",
].join("\n")

const SPANISH_LYRICS = [
	"Carlos Vargas soy intérprete del corazón",
	"Que de emergencia te necesita",
	"Hey doctor deme una visita",
	"Que sin su amor mi corazón no puede vivir más",
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

const KOREAN_TTML_WITH_SONGWRITERS = `<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><songwriters><songwriter>Chase Mitchell</songwriter><songwriter>Andrew Smith</songwriter></songwriters></metadata></head><body><div>${KOREAN_LYRICS
	.split("\n")
	.map((line) => `<p>${line}</p>`)
	.join("")}</div></body></tt>`

const SPANISH_TTML_WITH_SONGWRITERS = `<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata><songwriters><songwriter>John Songwriter</songwriter><songwriter>Mike Producer</songwriter></songwriters></metadata></head><body><div>${SPANISH_LYRICS
	.split("\n")
	.map((line) => `<p>${line}</p>`)
	.join("")}</div></body></tt>`

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

		it("detects Spanish plain lyrics", () => {
			expect(detectLanguage(SPANISH_LYRICS, "plain")).toBe("es")
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
	})

	describe("regressions", () => {
		it("returns en for representative English lyrics (row 818 motivation)", () => {
			expect(detectLanguage(ENGLISH_LYRICS, "plain")).toBe("en")
		})

		it("returns ko for K-pop with English filler when no xml:lang is present", () => {
			expect(detectLanguage(KOREAN_WITH_ENGLISH_FILLER, "plain")).toBe("ko")
		})

		it("returns ko for Korean lyrics inside TTML that carries Western songwriter names", () => {
			expect(detectLanguage(KOREAN_TTML_WITH_SONGWRITERS, "ttml")).toBe("ko")
		})

		it("returns es for Spanish lyrics inside TTML that carries Western songwriter names", () => {
			expect(detectLanguage(SPANISH_TTML_WITH_SONGWRITERS, "ttml")).toBe("es")
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

		it("never returns a 3-letter ISO 639-3 code", () => {
			const samples = [ENGLISH_LYRICS, JAPANESE_LYRICS, KOREAN_LYRICS, SPANISH_LYRICS]
			for (const text of samples) {
				const result = detectLanguage(text, "plain")
				if (result !== null) expect(result.length).toBeLessThanOrEqual(2)
			}
		})
	})

	describe("detector version", () => {
		it("exposes a numeric DETECTOR_VERSION", () => {
			expect(typeof DETECTOR_VERSION).toBe("number")
			expect(DETECTOR_VERSION).toBeGreaterThan(0)
		})
	})
})
