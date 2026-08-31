import { describe, expect, it } from "vitest"
import { normalize, normalizeArtist, normalizeSong } from "./normalize"

describe("normalize", () => {
	describe("happy paths", () => {
		it("lowercases and trims", () => {
			expect(normalize("  Hello World  ")).toBe("hello world")
		})

		it("removes ASCII punctuation and symbols", () => {
			expect(normalize("Hello, World!")).toBe("hello world")
		})

		it("collapses runs of whitespace", () => {
			expect(normalize("a\t\n  b")).toBe("a b")
		})

		it("folds Latin diacritics to base letters", () => {
			expect(normalize("Beyoncé")).toBe("beyonce")
			expect(normalize("Sigur Rós")).toBe("sigur ros")
		})

		it("keeps digits", () => {
			expect(normalize("Area 51")).toBe("area 51")
		})
	})

	describe("non-Latin scripts (regression: issue #54)", () => {
		it("preserves Japanese kanji", () => {
			expect(normalize("今すぐ輪廻")).toBe("今すぐ輪廻")
		})

		it("preserves Japanese hiragana", () => {
			expect(normalize("いますぐ輪廻")).toBe("いますぐ輪廻")
		})

		it("preserves Japanese katakana", () => {
			expect(normalize("ナキソ")).toBe("ナキソ")
		})

		it("preserves Korean hangul", () => {
			expect(normalize("방탄소년단")).toBe("방탄소년단")
		})

		it("preserves Cyrillic and lowercases it", () => {
			expect(normalize("Тату")).toBe("тату")
		})

		it("preserves Greek letters while folding accents", () => {
			expect(normalize("Ελλάδα")).toBe("ελλαδα")
		})

		it("keeps CJK while still stripping punctuation around it", () => {
			expect(normalize("「今すぐ輪廻」")).toBe("今すぐ輪廻")
		})

		it("preserves mixed Latin and CJK", () => {
			expect(normalize("Naki 今すぐ")).toBe("naki 今すぐ")
		})
	})

	describe("edge cases", () => {
		it("returns empty string for empty input", () => {
			expect(normalize("")).toBe("")
		})

		it("returns empty string for whitespace only", () => {
			expect(normalize("   ")).toBe("")
		})

		it("strips emoji as symbols", () => {
			expect(normalize("hello 🎵 world")).toBe("hello world")
		})

		it("returns empty string for punctuation-only input", () => {
			expect(normalize("!!!")).toBe("")
		})
	})
})

describe("normalizeSong", () => {
	it("removes parenthetical suffixes", () => {
		expect(normalizeSong("Song Title (Official Video)")).toBe("song title")
		expect(normalizeSong("Song Title [Lyrics]")).toBe("song title")
	})

	it("removes trailing dash-qualified descriptors", () => {
		expect(normalizeSong("Song Title - Official Music Video")).toBe("song title")
	})

	it("preserves a Japanese title (regression: issue #54)", () => {
		expect(normalizeSong("今すぐ輪廻")).toBe("今すぐ輪廻")
		expect(normalizeSong("いますぐ輪廻")).toBe("いますぐ輪廻")
	})

	it("preserves a Japanese title with an English descriptor suffix", () => {
		expect(normalizeSong("いますぐ輪廻 (Official Audio)")).toBe("いますぐ輪廻")
	})
})

describe("normalizeArtist", () => {
	it("removes featured artists", () => {
		expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake")
		expect(normalizeArtist("Drake ft. Rihanna")).toBe("drake")
	})

	it("normalizes ampersand to 'and'", () => {
		expect(normalizeArtist("Simon & Garfunkel")).toBe("simon and garfunkel")
	})

	it("preserves a Japanese artist name (regression: issue #54)", () => {
		expect(normalizeArtist("なきそ")).toBe("なきそ")
	})
})
