import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	type ParsedTranslationLine,
	UnparseableResponseError,
	buildLyricsTranslateUrl,
	parseLyricsTranslateResponse,
	toLyricsTranslateLang,
} from "./google-translate"

function fixture(name: string): string {
	return readFileSync(
		new URL(`./__fixtures__/google-lyrics-translate/${name}.txt`, import.meta.url),
		"utf8"
	)
}

const TWINKLE = [
	"Twinkle, twinkle, little star",
	"How I wonder what you are",
	"Up above the world so high",
	"Like a diamond in the sky",
	"When the blazing sun is gone",
	"When he nothing shines upon",
	"Then you show your little light",
	"Twinkle, twinkle, all the night",
	"Then the traveller in the dark",
	"Thanks you for your tiny spark",
	"Twinkle, twinkle, little star",
	"How I wonder what you are",
]

const SOURCE_LINES: Record<string, string[]> = {
	"zh-en-romanized": ["你问我爱你有多深", "月亮代表我的心"],
	"ja-en-no-romanization": ["夜に駆ける", "君の名は"],
	"zh-en-already-target": ["Hello world", "你好世界"],
	"zh-en-blank-line-split": ["你好", "世界"],
	"ko-en-romanized": ["사랑해", "안녕하세요"],
	"zh-en-apostrophe": ["我不知道你在哪里"],
	"zh-en-single-line": ["你好世界"],
	"en-zh-Hant-packed-blocks": TWINKLE,
	"en-id-sentence-split": [
		"[Music]",
		"[Music]",
		"Heat.",
		"[Music]",
		"Heat.",
		"[Music]",
		"Heat. Heat.",
		"[Music]",
		"Hey.",
		"[Music]",
	],
	"ja-ko-cjk-sentence-split": [
		"何を買う？誰と買う？",
		"最近はどう？ かなりストレイト",
		"溜まるストレスと 闘うクラスメイト",
	],
}

function parse(name: string, sourceLines = SOURCE_LINES[name]) {
	return parseLyricsTranslateResponse(fixture(name), {
		httpStatus: 200,
		version: "test-version",
		sourceLines,
	})
}

function segment(original: string, translation: string, romanization?: string): string {
	const roman =
		romanization === undefined
			? ""
			: `<span jsname="tSjPGf"><br aria-hidden="true"><span>${romanization}</span></span>`
	return `<span jsname="UVGAte"><span>${translation}</span><br aria-hidden="true"></span><span jsname="YS01Ge" class="gOGZsb">${original}</span>${roman}<br aria-hidden="true"><br aria-hidden="true">`
}

function body(...segments: string[]): string {
	return `)]}'
22;["id","tok"]c;[2,null,"0"]1;<div jsname="Vinbg"></div><div jsname="WbKHeb"><div jsname="U8S5sf" class="ujudUb WRZytc">${segments.join("")}</div></div>c;[9,null,"0"]0;`
}

function parseBody(raw: string, sourceLines: string[]) {
	return parseLyricsTranslateResponse(raw, { httpStatus: 200, version: null, sourceLines })
}

describe("parseLyricsTranslateResponse", () => {
	it("parses a Chinese song with pinyin romanization", () => {
		const result = parse("zh-en-romanized")
		expect(result.googleId).toBe("15GUarMdo93j4Q_4ip2xCw")
		expect(result.googleToken).toBe("2527")
		expect(result.httpStatus).toBe(200)
		expect(result.googleVersion).toBe("test-version")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "你问我爱你有多深",
				translation: "You ask me how deeply I love you",
				romanization: "Nǐ wèn wǒ ài nǐ yǒu duō shēn",
				needsTranslation: true,
			},
			{
				original: "月亮代表我的心",
				translation: "The moon represents my heart",
				romanization: "yuèliàng dàibiǎo wǒ de xīn",
				needsTranslation: true,
			},
		])
	})

	it("parses a Japanese song with no romanization span as null", () => {
		const result = parse("ja-en-no-romanization")
		expect(result.googleId).toBe("15GUaqfVBovc4-EPo9u_gQM")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "夜に駆ける",
				translation: "run into the night",
				romanization: null,
				needsTranslation: true,
			},
			{
				original: "君の名は",
				translation: "your name is",
				romanization: null,
				needsTranslation: true,
			},
		])
	})

	it("marks an already-translated line as needsTranslation false", () => {
		const result = parse("zh-en-already-target")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "Hello world",
				translation: "Hello world",
				romanization: "Hello world",
				needsTranslation: false,
			},
			{
				original: "你好世界",
				translation: "Hello World",
				romanization: "nǐ hǎo shìjiè",
				needsTranslation: true,
			},
		])
	})

	it("walks multiple U8S5sf groups produced by a blank input line", () => {
		const result = parse("zh-en-blank-line-split")
		expect(result.googleId).toBe("15GUaq-RE4nm4-EPzb7YqQ8")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{ original: "你好", translation: "Hello", romanization: "Nǐ hǎo", needsTranslation: true },
			{ original: "世界", translation: "world", romanization: "Shìjiè", needsTranslation: true },
		])
	})

	it("parses a Korean song with romanization", () => {
		const result = parse("ko-en-romanized")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "사랑해",
				translation: "love you",
				romanization: "salanghae",
				needsTranslation: true,
			},
			{
				original: "안녕하세요",
				translation: "hello",
				romanization: "annyeonghaseyo",
				needsTranslation: true,
			},
		])
	})

	it("preserves a literal apostrophe in the translation", () => {
		const result = parse("zh-en-apostrophe")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "我不知道你在哪里",
				translation: "i don't know where you are",
				romanization: "Wǒ bù zhīdào nǐ zài nǎlǐ",
				needsTranslation: true,
			},
		])
		expect(result.lines[0].translation).toContain("'")
	})

	it("unescapes HTML entities in span text without double-decoding", () => {
		const body = `)]}'
1;["id","tok"]c;[2,null,"0"]1;<div jsname="WbKHeb"><div jsname="U8S5sf"><span jsname="UVGAte"><span>You &amp; Me &lt;3 &amp;lt;tag&gt;</span></span><span jsname="YS01Ge">你和我</span></div></div>c;[9,null,"0"]0;`
		const result = parseLyricsTranslateResponse(body, {
			httpStatus: 200,
			version: null,
			sourceLines: ["你和我"],
		})
		expect(result.lines[0].translation).toBe("You & Me <3 &lt;tag>")
		expect(result.lines[0].original).toBe("你和我")
	})

	it("parses a single-line response", () => {
		const result = parse("zh-en-single-line")
		expect(result.googleId).toBe("UpKUauTWJde74-EP4Mv0mA4")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{
				original: "你好世界",
				translation: "Hello World",
				romanization: "Nǐ hǎo shìjiè",
				needsTranslation: true,
			},
		])
	})

	it("exposes rawPayload from WbKHeb up to but excluding the trailer chunk", () => {
		const result = parse("zh-en-romanized")
		expect(result.rawPayload.startsWith('<div jsname="WbKHeb">')).toBe(true)
		expect(result.rawPayload).not.toContain("c;[9,")
		expect(result.rawPayload).toContain('jsname="U8S5sf"')
	})

	describe("edge cases", () => {
		it("strips the trailing newline so no field carries a newline or edge whitespace", () => {
			const result = parse("zh-en-romanized")
			for (const line of result.lines) {
				for (const value of [line.original, line.translation, line.romanization]) {
					if (value === null) continue
					expect(value).not.toContain("\n")
					expect(value).toBe(value.trim())
				}
			}
		})

		it("succeeds when the blank-line split yields exactly the expected count", () => {
			expect(() => parse("zh-en-blank-line-split")).not.toThrow()
		})

		it("throws when the source has more lines than the response carries", () => {
			expect(() => parse("zh-en-blank-line-split", ["你好", "世界", "再见"])).toThrow(
				/line count mismatch/i
			)
		})

		it("throws on an empty body", () => {
			expect(() =>
				parseLyricsTranslateResponse("", {
					httpStatus: 200,
					version: null,
					sourceLines: ["你好"],
				})
			).toThrow()
		})

		it("throws on a whitespace-only body", () => {
			expect(() =>
				parseLyricsTranslateResponse("   \n  ", {
					httpStatus: 200,
					version: null,
					sourceLines: ["你好"],
				})
			).toThrow()
		})

		it("throws when the payload lacks the WbKHeb marker", () => {
			expect(() =>
				parseLyricsTranslateResponse(')]}\'\n21;["x","y"]c;[2,null,"0"]0;', {
					httpStatus: 200,
					version: null,
					sourceLines: ["你好"],
				})
			).toThrow()
		})

		it("throws when a truncated body parses fewer lines than expected", () => {
			const full = fixture("zh-en-romanized")
			const sep = '<br aria-hidden="true"><br aria-hidden="true">'
			const truncated = `${full.slice(0, full.indexOf(sep))}</div></div>c;[9,null,"0"]0;`
			expect(() =>
				parseLyricsTranslateResponse(truncated, {
					httpStatus: 200,
					version: null,
					sourceLines: SOURCE_LINES["zh-en-romanized"],
				})
			).toThrow(/line count mismatch/i)
		})

		it("throws when a line count-matches but has empty content", () => {
			const body = `)]}'
1;["id","tok"]c;[2,null,"0"]1;<div jsname="WbKHeb"><div jsname="U8S5sf"><span jsname="UVGAte"><span>hello</span></span><span jsname="YS01Ge"></span></div></div>c;[9,null,"0"]0;`
			expect(() =>
				parseLyricsTranslateResponse(body, {
					httpStatus: 200,
					version: null,
					sourceLines: ["你好"],
				})
			).toThrow(/empty original or translation/i)
		})
	})

	describe("invariants", () => {
		it("is deterministic across repeated calls on the same input", () => {
			expect(parse("zh-en-romanized").lines).toEqual(parse("zh-en-romanized").lines)
		})

		it("preserves source line order", () => {
			const result = parse("zh-en-romanized")
			expect(result.lines.map((l) => l.translation)).toEqual([
				"You ask me how deeply I love you",
				"The moon represents my heart",
			])
		})

		it("yields a null-or-string romanization and a boolean needsTranslation per line", () => {
			const result = parse("ja-en-no-romanization")
			for (const line of result.lines) {
				expect(line.romanization === null || typeof line.romanization === "string").toBe(true)
				expect(typeof line.needsTranslation).toBe("boolean")
			}
		})
	})

	describe("regressions", () => {
		it("regression: splits a block that packs ten lines into one span", () => {
			const result = parse("en-zh-Hant-packed-blocks")
			expect(result.lines).toHaveLength(12)
			expect(result.lines[0]).toEqual<ParsedTranslationLine>({
				original: "Twinkle, twinkle, little star",
				translation: "一閃一閃小星星",
				romanization: null,
				needsTranslation: true,
			})
			expect(result.lines[9].translation).toBe("感謝你微小的火花")
			expect(result.lines[10].translation).toBe("一閃一閃小星星")
			expect(result.lines[11]).toEqual<ParsedTranslationLine>({
				original: "How I wonder what you are",
				translation: "我多想知道你是什麼",
				romanization: null,
				needsTranslation: true,
			})
		})

		it("regression: joins a line Google splits into two sentences", () => {
			const result = parse("en-id-sentence-split")
			expect(result.lines).toHaveLength(10)
			expect(result.lines[6]).toEqual<ParsedTranslationLine>({
				original: "Heat. Heat.",
				translation: "Panas. Panas.",
				romanization: null,
				needsTranslation: true,
			})
			expect(result.lines[7].translation).toBe("[Musik]")
			expect(result.lines[9].translation).toBe("[Musik]")
		})

		it("regression: joins a CJK sentence split that leaves no space in the original", () => {
			const result = parse("ja-ko-cjk-sentence-split")
			expect(result.lines.map((l) => [l.original, l.translation])).toEqual([
				["何を買う？誰と買う？", "무엇을 사? 더 누구와 사?"],
				["最近はどう？ かなりストレイト", "요즘은 어때? 꽤 스트레이트"],
				["溜まるストレスと 闘うクラスメイト", "모이는 스트레스와 싸우는 클래스 메이트"],
			])
		})

		it("regression: aligns a source line whose control character Google echoes as a space", () => {
			const raw = body(segment("We were born  born to be wild", "Kami terlahir untuk liar"))
			const result = parseBody(raw, ["We were born\x7F born to be wild"])
			expect(result.lines[0].original).toBe("We were born\x7F born to be wild")
			expect(result.lines[0].translation).toBe("Kami terlahir untuk liar")
		})

		it("regression: aligns source lines whose U+FFFD Google drops or blanks in its echo", () => {
			const raw = body(segment("Al Rey Salom n\n呜", "To King Solomon\nWoo"))
			const result = parseBody(raw, ["Al Rey Salom\uFFFDn", "呜\uFFFD\uFFFD"])
			expect(result.lines.map((l) => l.translation)).toEqual(["To King Solomon", "Woo"])
		})

		it("regression: keeps a spacer line made only of zero-width characters", () => {
			const raw = body(
				segment(
					"夜に駆ける\n\u200B\u200B\n君の名は",
					"run into the night\n\u200B\u200B\nyour name is"
				)
			)
			expect(
				parseBody(raw, ["夜に駆ける", "\u200B\u200B", "君の名は"]).lines.map((l) => l.translation)
			).toEqual(["run into the night", "\u200B\u200B", "your name is"])
		})

		it("regression: keeps consecutive zero-width spacer lines on their own lines", () => {
			const raw = body(
				segment("\u200E", "\u200E"),
				segment("\u200C", "\u200C"),
				segment("君の名は", "your name is")
			)
			expect(
				parseBody(raw, ["\u200E", "\u200C", "君の名は"]).lines.map((l) => l.translation)
			).toEqual(["\u200E", "\u200C", "your name is"])
		})

		it("regression: aligns a source line carrying a zero-width character Google drops", () => {
			const raw = body(segment("まだら模様", "Mottled"))
			expect(parseBody(raw, ["\u200Bまだら模様\uFEFF"]).lines[0].translation).toBe("Mottled")
		})
	})

	describe("segment alignment", () => {
		it("splits romanization inside a packed block line by line", () => {
			const raw = body(segment("你好\n世界", "Hello\nworld", "Nǐ hǎo\nShìjiè"))
			expect(parseBody(raw, ["你好", "世界"]).lines).toEqual<ParsedTranslationLine[]>([
				{ original: "你好", translation: "Hello", romanization: "Nǐ hǎo", needsTranslation: true },
				{ original: "世界", translation: "world", romanization: "Shìjiè", needsTranslation: true },
			])
		})

		it("drops romanization for a block whose romanization lines do not line up", () => {
			const raw = body(segment("你好\n世界", "Hello\nworld", "Nǐ hǎo shìjiè"))
			const result = parseBody(raw, ["你好", "世界"])
			expect(result.lines.map((l) => l.romanization)).toEqual([null, null])
			expect(result.lines.map((l) => l.translation)).toEqual(["Hello", "world"])
		})

		it("nulls the romanization of a joined line when one of its pieces has none", () => {
			const raw = body(segment("你好。", "Hello. ", "Nǐ hǎo."), segment("世界", "World"))
			expect(parseBody(raw, ["你好。世界"]).lines[0].romanization).toBeNull()
		})

		it("joins romanization across a sentence split with a space, since Google drops its trailing whitespace", () => {
			const raw = body(segment("你好。", "Hello. ", "Nǐ hǎo."), segment("世界", "World", "Shìjiè"))
			expect(parseBody(raw, ["你好。世界"]).lines[0]).toEqual<ParsedTranslationLine>({
				original: "你好。世界",
				translation: "Hello. World",
				romanization: "Nǐ hǎo. Shìjiè",
				needsTranslation: true,
			})
		})

		it("handles a packed block and a sentence split in the same response", () => {
			const raw = body(segment("一\n二。", "One\nTwo. "), segment("三\n四", "Three\nFour"))
			expect(parseBody(raw, ["一", "二。三", "四"]).lines.map((l) => l.translation)).toEqual([
				"One",
				"Two. Three",
				"Four",
			])
		})

		it("aligns duplicate lines by position, not by text", () => {
			const raw = body(segment("啦\n啦\n啦", "La\nLa la\nLa la la"))
			expect(parseBody(raw, ["啦", "啦", "啦"]).lines.map((l) => l.translation)).toEqual([
				"La",
				"La la",
				"La la la",
			])
		})

		it("throws when Google echoes an original that differs from the source line", () => {
			const raw = body(segment("你好", "Hello"))
			expect(() => parseBody(raw, ["再见"])).toThrow(/original text mismatch/i)
		})

		it("throws when the response carries more lines than the source", () => {
			const raw = body(segment("你好\n世界", "Hello\nworld"))
			expect(() => parseBody(raw, ["你好"])).toThrow(/line count mismatch/i)
		})

		it("throws when a block's translation and original line counts differ", () => {
			const raw = body(segment("你好\n世界", "Hello world"))
			expect(() => parseBody(raw, ["你好", "世界"])).toThrow(UnparseableResponseError)
		})

		it("throws when a block line has an original but no translation", () => {
			const raw = body(segment("你好\n世界", "Hello\n "))
			expect(() => parseBody(raw, ["你好", "世界"])).toThrow(/empty original or translation/i)
		})
	})

	describe("alignment invariants", () => {
		const shapes = Object.keys(SOURCE_LINES)

		it.each(shapes)("returns one line per source line for %s", (name) => {
			expect(parse(name).lines).toHaveLength(SOURCE_LINES[name].length)
		})

		it.each(shapes)("echoes each source line as the original for %s", (name) => {
			expect(parse(name).lines.map((l) => l.original)).toEqual(SOURCE_LINES[name])
		})

		it.each(shapes)("never leaves a newline or edge whitespace in %s", (name) => {
			for (const line of parse(name).lines) {
				for (const value of [line.translation, line.romanization]) {
					if (value === null) continue
					expect(value).not.toContain("\n")
					expect(value).toBe(value.trim())
				}
			}
		})
	})
})

describe("UnparseableResponseError", () => {
	const emptyLineBody = `)]}'
1;["id","tok"]c;[2,null,"0"]1;<div jsname="WbKHeb"><div jsname="U8S5sf"><span jsname="UVGAte"><span>hello</span></span><span jsname="YS01Ge"></span></div></div>c;[9,null,"0"]0;`

	it("throws UnparseableResponseError when the WbKHeb marker is missing", () => {
		expect(() =>
			parseLyricsTranslateResponse("body without a marker", {
				httpStatus: 200,
				version: null,
				sourceLines: ["你好"],
			})
		).toThrow(UnparseableResponseError)
	})

	it("throws UnparseableResponseError on a line-count mismatch", () => {
		expect(() => parse("zh-en-blank-line-split", ["你好", "世界", "再见"])).toThrow(
			UnparseableResponseError
		)
	})

	it("throws UnparseableResponseError on an empty content line", () => {
		expect(() =>
			parseLyricsTranslateResponse(emptyLineBody, {
				httpStatus: 200,
				version: null,
				sourceLines: ["你好"],
			})
		).toThrow(UnparseableResponseError)
	})

	it("carries the http status and the raw payload for later reprocessing", () => {
		try {
			parseLyricsTranslateResponse("body without a marker", {
				httpStatus: 200,
				version: null,
				sourceLines: ["你好"],
			})
			throw new Error("expected a throw")
		} catch (err) {
			expect(err).toBeInstanceOf(UnparseableResponseError)
			const e = err as UnparseableResponseError
			expect(e.httpStatus).toBe(200)
			expect(e.rawPayload).toBe("body without a marker")
		}
	})
})

describe("buildLyricsTranslateUrl", () => {
	it("joins lines with an encoded newline", () => {
		const url = buildLyricsTranslateUrl("zh", "en", ["first", "second"])
		expect(url).toContain("first%0Asecond")
	})

	it("carries the language codes, title, partial marker, ui context, and format", () => {
		const url = buildLyricsTranslateUrl("ja", "en", ["hi"])
		expect(url.startsWith("https://www.google.com/async/lyrics_translate?async=")).toBe(true)
		expect(url).toContain("lyrics_partial:,")
		expect(url).toContain("title:idk")
		expect(url).toContain("lang_code_from:ja")
		expect(url).toContain("lang_code_to:en")
		expect(url).toContain("exp_ui_ctx:3")
		expect(url).toContain("_fmt:pc")
	})

	it("encodes commas and spaces so a line cannot break structural params", () => {
		const url = buildLyricsTranslateUrl("zh", "en", ["hello, world"])
		expect(url).toContain("lyrics_full:hello%2C%20world,title:idk")
		expect(url).not.toContain("hello, world")
	})
})

describe("toLyricsTranslateLang", () => {
	it("maps Traditional Chinese regions and scripts to zh-Hant", () => {
		for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW", "zh-Hant-HK"]) {
			expect(toLyricsTranslateLang(tag)).toBe("zh-Hant")
		}
	})

	it("maps Simplified Chinese regions and scripts to zh", () => {
		for (const tag of ["zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN"]) {
			expect(toLyricsTranslateLang(tag)).toBe("zh")
		}
	})

	it("drops a region the upstream rejects when the script is unchanged", () => {
		expect(toLyricsTranslateLang("pt-BR")).toBe("pt")
		expect(toLyricsTranslateLang("pt-PT")).toBe("pt")
		expect(toLyricsTranslateLang("en-US")).toBe("en")
		expect(toLyricsTranslateLang("es-419")).toBe("es")
		expect(toLyricsTranslateLang("ja-JP")).toBe("ja")
	})

	describe("edge cases", () => {
		it("leaves bare codes untouched, including ones Intl would rewrite", () => {
			for (const tag of ["en", "zh", "he", "iw", "tl", "fil", "jw", "mni", "yue"]) {
				expect(toLyricsTranslateLang(tag)).toBe(tag)
			}
		})

		it("handles mixed case and underscore separators", () => {
			expect(toLyricsTranslateLang("ZH-tw")).toBe("zh-Hant")
			expect(toLyricsTranslateLang("zh-hant")).toBe("zh-Hant")
			expect(toLyricsTranslateLang("zh_TW")).toBe("zh-Hant")
			expect(toLyricsTranslateLang("zh_CN")).toBe("zh")
		})

		it("keeps the client's primary subtag instead of an Intl-canonicalized alias", () => {
			expect(toLyricsTranslateLang("jw-ID")).toBe("jw")
			expect(toLyricsTranslateLang("iw-IL")).toBe("iw")
			expect(toLyricsTranslateLang("tl-PH")).toBe("tl")
			expect(toLyricsTranslateLang("cmn-TW")).toBe("zh-Hant")
		})

		it("keeps a tag whose script the bare language would lose", () => {
			expect(toLyricsTranslateLang("sr-Latn")).toBe("sr-Latn")
			expect(toLyricsTranslateLang("mni-Mtei")).toBe("mni-Mtei")
			expect(toLyricsTranslateLang("pa-Arab")).toBe("pa-Arab")
			expect(toLyricsTranslateLang("zh-Latn")).toBe("zh-Latn")
		})

		it("returns malformed tags unchanged", () => {
			for (const tag of ["", "x-foo", "!!", "zh--TW", "-"]) {
				expect(toLyricsTranslateLang(tag)).toBe(tag)
			}
		})
	})

	describe("regressions", () => {
		it("regression: does not send zh-TW, which the upstream answers with HTTP 400", () => {
			const url = buildLyricsTranslateUrl("en", toLyricsTranslateLang("zh-TW"), ["hi"])
			expect(url).toContain("lang_code_to:zh-Hant,")
			expect(url).not.toContain("zh-TW")
		})

		it("regression: does not send zh-CN or zh-Hans, which the upstream answers with HTTP 400", () => {
			expect(toLyricsTranslateLang("zh-CN")).not.toBe("zh-CN")
			expect(toLyricsTranslateLang("zh-Hans")).not.toBe("zh-Hans")
		})
	})

	describe("invariants", () => {
		const tags = [
			"zh-TW",
			"zh-CN",
			"zh-Hant-TW",
			"pt-BR",
			"en-US",
			"sr-Latn",
			"mni-Mtei",
			"en",
			"x-foo",
		]

		it("is idempotent", () => {
			for (const tag of tags) {
				const once = toLyricsTranslateLang(tag)
				expect(toLyricsTranslateLang(once)).toBe(once)
			}
		})

		it("never turns Traditional into Simplified or the reverse", () => {
			expect(toLyricsTranslateLang("zh-TW")).not.toBe("zh")
			expect(toLyricsTranslateLang("zh-CN")).not.toBe("zh-Hant")
		})
	})
})

describe("fetchLyricsTranslation", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.resetModules()
	})

	async function loadFresh() {
		vi.resetModules()
		return import("./google-translate")
	}

	it("fetches, parses, and returns the aligned translation", async () => {
		const { fetchLyricsTranslation } = await loadFresh()
		const fetchSpy = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response(fixture("zh-en-single-line"), {
					status: 200,
					headers: { version: "v-42" },
				})
		)
		vi.stubGlobal("fetch", fetchSpy)

		const result = await fetchLyricsTranslation("zh", "en", ["你好世界"])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(fetchSpy.mock.calls[0][0]).toContain("google.com/async/lyrics_translate")
		const init = fetchSpy.mock.calls[0][1] as RequestInit
		expect((init.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla/5.0")
		expect(result.httpStatus).toBe(200)
		expect(result.googleVersion).toBe("v-42")
		expect(result.googleId).toBe("UpKUauTWJde74-EP4Mv0mA4")
		expect(result.lines[0].translation).toBe("Hello World")
	})

	it("throws with no line to translate and never touches the network", async () => {
		const { fetchLyricsTranslation } = await loadFresh()
		const fetchSpy = vi.fn(async () => new Response("", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)

		await expect(fetchLyricsTranslation("zh", "en", [])).rejects.toThrow()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("throws when the upstream status is not ok", async () => {
		const { fetchLyricsTranslation } = await loadFresh()
		const fetchSpy = vi.fn(async () => new Response("upstream boom", { status: 502 }))
		vi.stubGlobal("fetch", fetchSpy)

		await expect(fetchLyricsTranslation("zh", "en", ["你好世界"])).rejects.toThrow()
	})

	it("throws when a 200 comes back with an empty body", async () => {
		const { fetchLyricsTranslation } = await loadFresh()
		const fetchSpy = vi.fn(async () => new Response("   ", { status: 200 }))
		vi.stubGlobal("fetch", fetchSpy)

		await expect(fetchLyricsTranslation("zh", "en", ["你好世界"])).rejects.toThrow()
	})
})
