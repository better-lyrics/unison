import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	type ParsedTranslationLine,
	UnparseableResponseError,
	buildLyricsTranslateUrl,
	parseLyricsTranslateResponse,
} from "./google-translate"

function fixture(name: string): string {
	return readFileSync(
		new URL(`./__fixtures__/google-lyrics-translate/${name}.txt`, import.meta.url),
		"utf8"
	)
}

function parse(name: string, expectedLineCount: number) {
	return parseLyricsTranslateResponse(fixture(name), {
		httpStatus: 200,
		version: "test-version",
		expectedLineCount,
	})
}

describe("parseLyricsTranslateResponse", () => {
	it("parses a Chinese song with pinyin romanization", () => {
		const result = parse("zh-en-romanized", 2)
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
		const result = parse("ja-en-no-romanization", 2)
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
		const result = parse("zh-en-already-target", 2)
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
		const result = parse("zh-en-blank-line-split", 2)
		expect(result.googleId).toBe("15GUaq-RE4nm4-EPzb7YqQ8")
		expect(result.lines).toEqual<ParsedTranslationLine[]>([
			{ original: "你好", translation: "Hello", romanization: "Nǐ hǎo", needsTranslation: true },
			{ original: "世界", translation: "world", romanization: "Shìjiè", needsTranslation: true },
		])
	})

	it("parses a Korean song with romanization", () => {
		const result = parse("ko-en-romanized", 2)
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
		const result = parse("zh-en-apostrophe", 1)
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
			expectedLineCount: 1,
		})
		expect(result.lines[0].translation).toBe("You & Me <3 &lt;tag>")
		expect(result.lines[0].original).toBe("你和我")
	})

	it("parses a single-line response", () => {
		const result = parse("zh-en-single-line", 1)
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
		const result = parse("zh-en-romanized", 2)
		expect(result.rawPayload.startsWith('<div jsname="WbKHeb">')).toBe(true)
		expect(result.rawPayload).not.toContain("c;[9,")
		expect(result.rawPayload).toContain('jsname="U8S5sf"')
	})

	describe("edge cases", () => {
		it("strips the trailing newline so no field carries a newline or edge whitespace", () => {
			const result = parse("zh-en-romanized", 2)
			for (const line of result.lines) {
				for (const value of [line.original, line.translation, line.romanization]) {
					if (value === null) continue
					expect(value).not.toContain("\n")
					expect(value).toBe(value.trim())
				}
			}
		})

		it("succeeds when the blank-line split yields exactly the expected count", () => {
			expect(() => parse("zh-en-blank-line-split", 2)).not.toThrow()
		})

		it("throws when the expected count includes the dropped blank line", () => {
			expect(() => parse("zh-en-blank-line-split", 3)).toThrow(/line count mismatch/i)
		})

		it("throws on an empty body", () => {
			expect(() =>
				parseLyricsTranslateResponse("", {
					httpStatus: 200,
					version: null,
					expectedLineCount: 1,
				})
			).toThrow()
		})

		it("throws on a whitespace-only body", () => {
			expect(() =>
				parseLyricsTranslateResponse("   \n  ", {
					httpStatus: 200,
					version: null,
					expectedLineCount: 1,
				})
			).toThrow()
		})

		it("throws when the payload lacks the WbKHeb marker", () => {
			expect(() =>
				parseLyricsTranslateResponse(')]}\'\n21;["x","y"]c;[2,null,"0"]0;', {
					httpStatus: 200,
					version: null,
					expectedLineCount: 1,
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
					expectedLineCount: 2,
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
					expectedLineCount: 1,
				})
			).toThrow(/empty original or translation/i)
		})
	})

	describe("invariants", () => {
		it("is deterministic across repeated calls on the same input", () => {
			expect(parse("zh-en-romanized", 2).lines).toEqual(parse("zh-en-romanized", 2).lines)
		})

		it("preserves source line order", () => {
			const result = parse("zh-en-romanized", 2)
			expect(result.lines.map((l) => l.translation)).toEqual([
				"You ask me how deeply I love you",
				"The moon represents my heart",
			])
		})

		it("yields a null-or-string romanization and a boolean needsTranslation per line", () => {
			const result = parse("ja-en-no-romanization", 2)
			for (const line of result.lines) {
				expect(line.romanization === null || typeof line.romanization === "string").toBe(true)
				expect(typeof line.needsTranslation).toBe("boolean")
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
				expectedLineCount: 1,
			})
		).toThrow(UnparseableResponseError)
	})

	it("throws UnparseableResponseError on a line-count mismatch", () => {
		expect(() => parse("zh-en-blank-line-split", 3)).toThrow(UnparseableResponseError)
	})

	it("throws UnparseableResponseError on an empty content line", () => {
		expect(() =>
			parseLyricsTranslateResponse(emptyLineBody, {
				httpStatus: 200,
				version: null,
				expectedLineCount: 1,
			})
		).toThrow(UnparseableResponseError)
	})

	it("carries the http status and the raw payload for later reprocessing", () => {
		try {
			parseLyricsTranslateResponse("body without a marker", {
				httpStatus: 200,
				version: null,
				expectedLineCount: 1,
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
