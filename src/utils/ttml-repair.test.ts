import { readMalformedTtml, readRevisionFixture } from "@/test/lyric-fixtures"
import { describe, expect, it } from "vitest"
import { extractComparableLines } from "./extract-text"
import { repairTtml } from "./ttml-repair"
import { validateLyricContent } from "./validate-lyrics"
import { findXmlProblem } from "./validation"

const REPAIRABLE = [
	"text-before-root",
	"code-fence",
	"trailing-junk",
	"two-documents",
	"unbound-prefix",
]
const UNREPAIRABLE = [
	"control-char",
	"mismatched-tag",
	"half-written-tag",
	"escaped-quotes",
	"bare-ampersand",
	"corrupted-tag",
]

describe("repairTtml", () => {
	describe("regressions: repairable failure classes found in stored lyrics", () => {
		for (const name of REPAIRABLE) {
			it(`regression: repairs ${name} into TTML that passes submit validation`, () => {
				const repaired = repairTtml(readMalformedTtml(name))
				expect(repaired).not.toBeNull()
				expect(findXmlProblem(repaired!)).toBeNull()
				expect(validateLyricContent(repaired!, "ttml").ok).toBe(true)
			})
		}

		it("regression: removes a code fence and its trailing citation", () => {
			const repaired = repairTtml(readMalformedTtml("code-fence"))!
			expect(repaired).not.toContain("```")
			expect(repaired).not.toContain("[cite: 1]")
			expect(repaired.endsWith("</tt>")).toBe(true)
		})

		it("regression: keeps the first of two glued documents", () => {
			const input = readMalformedTtml("two-documents")
			const repaired = repairTtml(input)!
			expect(repaired).toBe(input.slice(0, input.indexOf("</tt>") + "</tt>".length))
		})

		it("regression: declares the standard itunes namespace on the root", () => {
			const repaired = repairTtml(readMalformedTtml("unbound-prefix"))!
			expect(repaired).toContain('<tt xmlns:itunes="http://music.apple.com/lyric-ttml-internal"')
		})
	})

	describe("unrepairable input", () => {
		for (const name of UNREPAIRABLE) {
			it(`returns null for ${name}`, () => {
				expect(repairTtml(readMalformedTtml(name))).toBeNull()
			})
		}

		it("returns null for a prefix with no standard namespace", () => {
			const input = readMalformedTtml("unbound-prefix").replace("itunes:timing", "quick:timing")
			expect(repairTtml(input)).toBeNull()
		})

		it("returns null for content with no TTML root", () => {
			expect(repairTtml("Just a line of lyrics")).toBeNull()
			expect(repairTtml("")).toBeNull()
		})
	})

	describe("edge cases", () => {
		it("keeps an XML declaration in front of the root", () => {
			const repaired = repairTtml(readMalformedTtml("unbound-prefix"))!
			expect(repaired.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true)
		})

		it("drops a byte order mark together with the text before the root", () => {
			const repaired = repairTtml(`\uFEFF${readMalformedTtml("text-before-root")}`)!
			expect(repaired.startsWith("<tt")).toBe(true)
		})

		it("repairs a file with CRLF line ends", () => {
			const input = readMalformedTtml("trailing-junk").replace(/\n/g, "\r\n")
			expect(repairTtml(input)).not.toBeNull()
		})
	})

	describe("invariants", () => {
		it("never changes the lyric text", () => {
			for (const name of REPAIRABLE) {
				const input = readMalformedTtml(name)
				const start = input.search(/<\?xml|<tt[\s>]/)
				const firstDocument = input.slice(start, input.indexOf("</tt>") + "</tt>".length)
				expect(extractComparableLines(repairTtml(input)!, "ttml"), name).toEqual(
					extractComparableLines(firstDocument, "ttml")
				)
			}
		})

		it("is idempotent", () => {
			for (const name of REPAIRABLE) {
				const once = repairTtml(readMalformedTtml(name))!
				expect(repairTtml(once), name).toBe(once)
			}
		})

		it("returns a well-formed file unchanged", () => {
			const valid = readRevisionFixture("amazing-grace.ttml")
			expect(repairTtml(valid)).toBe(valid)
		})
	})
})
