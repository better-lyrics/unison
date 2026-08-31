import { describe, expect, it } from "vitest"
import { DETECTOR_VERSION, detectLanguage, detectLanguageBatch } from "./detect-language"

const SAMPLES: Record<string, string> = {
	en: "Hello darkness my old friend I've come to talk with you again",
	ko: "안녕하세요 반갑습니다 좋은 하루 되세요 사랑합니다",
	ja: "こんにちは 世界 私は 音楽 が 大好き です",
	zh: "月亮代表我的心 你问我爱你有多深 我爱你有几分",
	fr: "Non rien de rien non je ne regrette rien",
	es: "Bailando tu cuerpo y el mío llenando el vacío",
	hi: "तुम पास आए युं मुस्कुराए तुमने ना जाने क्या सपने दिखाए",
}

describe("detectLanguage", () => {
	for (const [code, text] of Object.entries(SAMPLES)) {
		it(`detects ${code} from real text and marks it ready`, async () => {
			expect(await detectLanguage(text)).toEqual({ language: code, ready: true })
		})
	}

	it("distinguishes CJK scripts from each other", async () => {
		expect((await detectLanguage(SAMPLES.ja)).language).toBe("ja")
		expect((await detectLanguage(SAMPLES.ko)).language).toBe("ko")
		expect((await detectLanguage(SAMPLES.zh)).language).toBe("zh")
	})
})

describe("edge cases", () => {
	it("returns null language for empty input, still ready", async () => {
		expect(await detectLanguage("")).toEqual({ language: null, ready: true })
	})

	it("returns null language for whitespace-only input, still ready", async () => {
		expect(await detectLanguage("   \n\t ")).toEqual({ language: null, ready: true })
	})

	it("returns null language for text too short to be reliable", async () => {
		expect(await detectLanguage("hi")).toEqual({ language: null, ready: true })
	})

	it("returns null language for undetectable gibberish", async () => {
		expect(await detectLanguage("asdf qwer zxcv hjkl")).toEqual({ language: null, ready: true })
	})

	it("returns null language for numbers and symbols only", async () => {
		expect(await detectLanguage("12345 67890 000 111")).toEqual({ language: null, ready: true })
		expect(await detectLanguage("!!! ??? ... ---")).toEqual({ language: null, ready: true })
	})

	it("returns null language for ambiguous romanized text", async () => {
		expect((await detectLanguage("annyeong haseyo bangapseumnida")).language).toBeNull()
	})
})

describe("invariants", () => {
	const inputs = [...Object.values(SAMPLES), "", "hi", "12345", "asdf qwer zxcv hjkl"]

	it("is always ready for any string input", async () => {
		for (const text of inputs) {
			expect((await detectLanguage(text)).ready).toBe(true)
		}
	})

	it("returns either null or a two-letter lowercase ISO 639-1 code", async () => {
		for (const text of inputs) {
			const { language } = await detectLanguage(text)
			if (language !== null) expect(language).toMatch(/^[a-z]{2}$/)
		}
	})

	it("is deterministic across repeated calls", async () => {
		const a = await detectLanguage(SAMPLES.fr)
		const b = await detectLanguage(SAMPLES.fr)
		expect(a).toEqual(b)
	})
})

describe("detectLanguageBatch", () => {
	it("returns per-item results in input order", async () => {
		const results = await detectLanguageBatch([SAMPLES.ko, SAMPLES.en, ""])
		expect(results).toEqual([
			{ language: "ko", ready: true },
			{ language: "en", ready: true },
			{ language: null, ready: true },
		])
	})

	it("returns an empty array for empty input", async () => {
		expect(await detectLanguageBatch([])).toEqual([])
	})

	it("handles a single item", async () => {
		expect(await detectLanguageBatch([SAMPLES.zh])).toEqual([{ language: "zh", ready: true }])
	})

	it("preserves length even when every item is undetectable", async () => {
		const results = await detectLanguageBatch(["123", "!!!", ""])
		expect(results).toHaveLength(3)
		expect(results.every((r) => r.language === null && r.ready)).toBe(true)
	})
})

describe("DETECTOR_VERSION", () => {
	it("is the integer 4", () => {
		expect(DETECTOR_VERSION).toBe(4)
	})
})
