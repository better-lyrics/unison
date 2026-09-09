import { describe, expect, it } from "vitest"
import { ttmlSignals } from "./ttml-signals"

const NS = 'xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"'
const doc = (body: string) => `<tt ${NS}><body><div>${body}</div></body></tt>`

const wordP = (inner: string, agent = "v1") =>
	`<p begin="0:00.000" end="0:02.000" ttm:agent="${agent}">${inner}</p>`
const word = (text: string, b = "0:00.000", e = "0:00.500") =>
	`<span begin="${b}" end="${e}">${text}</span>`

describe("ttmlSignals", () => {
	it("returns no signals for a clean word-synced document", () => {
		const ttml = doc(wordP(`${word("Hello ")}${word("world")}`))
		expect(ttmlSignals(ttml)).toEqual([])
	})

	describe("firm signals", () => {
		it("flags line-synced when no <p> has timed word spans", () => {
			const ttml = doc(`<p begin="0:00" end="0:02">Hello world</p>`)
			expect(ttmlSignals(ttml)).toContain("line-synced")
		})

		it("does not flag line-synced when at least one <p> has timed spans", () => {
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}`))
			expect(ttmlSignals(ttml)).not.toContain("line-synced")
		})

		it("flags filler-line for a bracketed instrumental placeholder", () => {
			const ttml = doc(`${wordP(`${word("Hello")}`)}${wordP(`${word("(Instrumental)")}`)}`)
			expect(ttmlSignals(ttml)).toContain("filler-line")
		})

		it.each(["(instrumental)", "(interlude)", "(intro)", "(outro)", "(solo)"])(
			"flags filler-line for %s",
			(placeholder) => {
				const ttml = doc(`${wordP(word("Real line"))}${wordP(word(placeholder))}`)
				expect(ttmlSignals(ttml)).toContain("filler-line")
			}
		)

		it("flags filler-line for an empty paragraph", () => {
			const ttml = doc(`${wordP(word("Hello"))}<p begin="0:03" end="0:04">   </p>`)
			expect(ttmlSignals(ttml)).toContain("filler-line")
		})

		it("flags stretched-spelling for 3+ identical consecutive letters", () => {
			const ttml = doc(wordP(`${word("Yeaaah ")}${word("now")}`))
			expect(ttmlSignals(ttml)).toContain("stretched-spelling")
		})

		it("does not flag stretched-spelling for two repeated letters", () => {
			const ttml = doc(wordP(`${word("Hello ")}${word("keeper")}`))
			expect(ttmlSignals(ttml)).not.toContain("stretched-spelling")
		})

		it("flags unbracketed-bg when a background span is not wrapped in parentheses", () => {
			const bg = `<span ttm:role="x-bg">${word("oohs")}</span>`
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}${bg}`))
			expect(ttmlSignals(ttml)).toContain("unbracketed-bg")
		})

		it("does not flag unbracketed-bg when the background is wrapped in parentheses", () => {
			const bg = `<span ttm:role="x-bg">${word("(ooh)")}</span>`
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}${bg}`))
			expect(ttmlSignals(ttml)).not.toContain("unbracketed-bg")
		})
	})

	describe("heuristic signals", () => {
		it("flags not-sentence-case when a line starts lowercase", () => {
			const ttml = doc(wordP(`${word("hello ")}${word("world")}`))
			expect(ttmlSignals(ttml)).toContain("not-sentence-case")
		})

		it("flags not-sentence-case when a line ends with a period", () => {
			const ttml = doc(wordP(`${word("Hello ")}${word("world.")}`))
			expect(ttmlSignals(ttml)).toContain("not-sentence-case")
		})

		it("does not flag not-sentence-case for a clean capitalized line", () => {
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}`))
			expect(ttmlSignals(ttml)).not.toContain("not-sentence-case")
		})

		it("flags multi-bracket-bg when one x-bg run holds two bracket pairs", () => {
			const bg = `<span ttm:role="x-bg">${word("(ooh) ")}${word("(aah)")}</span>`
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}${bg}`))
			expect(ttmlSignals(ttml)).toContain("multi-bracket-bg")
		})

		it("does not flag multi-bracket-bg for a single bracket pair", () => {
			const bg = `<span ttm:role="x-bg">${word("(ooh)")}</span>`
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}${bg}`))
			expect(ttmlSignals(ttml)).not.toContain("multi-bracket-bg")
		})

		it("flags handoff-candidate when one line references more than one agent", () => {
			const p = `<p begin="0:00" end="0:02" ttm:agent="v1">${word("Hey ")}<span begin="0:01" end="0:02" ttm:agent="v2">you</span></p>`
			expect(ttmlSignals(doc(p))).toContain("handoff-candidate")
		})

		it("does not flag handoff-candidate when a line references one agent", () => {
			const ttml = doc(wordP(`${word("Hello ")}${word("world")}`, "v1"))
			expect(ttmlSignals(ttml)).not.toContain("handoff-candidate")
		})
	})

	describe("edge cases", () => {
		it("returns [] for an empty string", () => {
			expect(ttmlSignals("")).toEqual([])
		})

		it("returns an array for partially malformed XML without throwing", () => {
			expect(() => ttmlSignals("<tt><body><p>unterminated")).not.toThrow()
			expect(Array.isArray(ttmlSignals("<tt><body><p>unterminated"))).toBe(true)
		})

		it("returns [] for a document with no paragraphs", () => {
			expect(ttmlSignals(doc(""))).toEqual([])
		})

		it("handles unicode word text without throwing", () => {
			const ttml = doc(wordP(`${word("こんにちは ")}${word("世界")}`))
			expect(Array.isArray(ttmlSignals(ttml))).toBe(true)
		})
	})

	describe("invariants", () => {
		it("returns each signal at most once", () => {
			const twoStretches = doc(`${wordP(word("Yeaaah"))}${wordP(word("Nooo", "v1"))}`)
			const signals = ttmlSignals(twoStretches)
			expect(new Set(signals).size).toBe(signals.length)
		})

		it("never throws on arbitrary non-TTML input", () => {
			expect(() => ttmlSignals("not xml at all { } <<<")).not.toThrow()
		})
	})
})
