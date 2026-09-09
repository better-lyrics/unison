import { describe, expect, it } from "vitest"
import { hasTranslationMarkers } from "./translation-markers"

const wrap = (bodyInner: string, ttAttrs = 'xml:lang="en"') =>
	`<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" ${ttAttrs}>
  <body><div>${bodyInner}</div></body>
</tt>`

describe("hasTranslationMarkers", () => {
	describe("explicit markers", () => {
		it("flags a ttm:role x-translation span", () => {
			const ttml = wrap('<p><span>原文</span><span ttm:role="x-translation">source</span></p>')
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})

		it("flags a ttm:role x-roman transliteration span", () => {
			const ttml = wrap('<p><span>日本語</span><span ttm:role="x-roman">nihongo</span></p>')
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})

		it("flags a <translations> element", () => {
			const ttml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="ko">
  <body><div><p>가사</p></div></body>
  <translations><translation><text>lyrics</text></translation></translations>
</tt>`
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})

		it("flags a bare <translation> element", () => {
			const ttml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="ko">
  <body><div><p>가사</p><translation>lyrics</translation></div></body>
</tt>`
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})
	})

	describe("dual language", () => {
		it("flags two distinct xml:lang values", () => {
			const ttml = wrap('<p xml:lang="es">Hola</p><p xml:lang="en">Hello</p>', 'xml:lang="es"')
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})
	})

	describe("negatives", () => {
		it("does not flag a monolingual document", () => {
			const ttml = wrap("<p>First line</p><p>Second line</p>")
			expect(hasTranslationMarkers(ttml)).toBe(false)
		})

		it("does not flag repeated identical xml:lang on lines", () => {
			const ttml = wrap('<p xml:lang="en">First</p><p xml:lang="en">Second</p>')
			expect(hasTranslationMarkers(ttml)).toBe(false)
		})

		it("does not flag timing attributes alone", () => {
			const ttml = wrap('<p begin="0s" end="5s">First</p>')
			expect(hasTranslationMarkers(ttml)).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("returns false for an empty string", () => {
			expect(hasTranslationMarkers("")).toBe(false)
		})

		it("returns false for malformed markup", () => {
			expect(hasTranslationMarkers("<<< not xml >>>")).toBe(false)
		})

		it("returns false for plain text", () => {
			expect(hasTranslationMarkers("just some lyrics with no tags")).toBe(false)
		})
	})

	describe("regressions", () => {
		it("regression: does not flag region subtags of one language (en + en-US + en-GB)", () => {
			const ttml = wrap('<p xml:lang="en-US">Color</p><p xml:lang="en-GB">Colour</p>')
			expect(hasTranslationMarkers(ttml)).toBe(false)
		})

		it("regression: still flags two languages that carry region subtags (en-US + fr-CA)", () => {
			const ttml = wrap(
				'<p xml:lang="en-US">Hello</p><p xml:lang="fr-CA">Bonjour</p>',
				'xml:lang="en-US"'
			)
			expect(hasTranslationMarkers(ttml)).toBe(true)
		})
	})
})
