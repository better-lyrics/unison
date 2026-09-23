import { readRevisionFixture, shiftLrc } from "@/test/lyric-fixtures"
import { type LyricLine, extractLines } from "@/utils/extract-text"
import { driftTtml, shiftTtml } from "@/utils/ttml-timing"
import { describe, expect, it } from "vitest"
import { measureDrift, normalizeLineText, textDrift, timingDrift, wordTokens } from "./lyric-drift"

const TTML = readRevisionFixture("amazing-grace.ttml")
const LRC = readRevisionFixture("amazing-grace.lrc")
const PLAIN = readRevisionFixture("amazing-grace.txt")

const ttmlLines = () => extractLines(TTML, "ttml")
const lrcLines = () => extractLines(LRC, "lrc")
const plain = (text: string): LyricLine[] => extractLines(text, "plain")

function replaceWord(lines: LyricLine[], lineIndex: number, from: string, to: string): LyricLine[] {
	return lines.map((line, index) =>
		index === lineIndex ? { ...line, text: line.text.replace(from, to) } : line
	)
}

describe("textDrift", () => {
	it("is 0 for identical lyrics", () => {
		expect(textDrift(ttmlLines(), ttmlLines())).toBe(0)
	})

	it("measures one replaced word in ten as 10%", () => {
		const before = plain("one two three four five\nsix seven eight nine ten")
		const after = plain("one two three four five\nsix seven eight nine eleven")
		expect(textDrift(before, after)).toBeCloseTo(0.1, 5)
	})

	it("ignores case, punctuation, and whitespace", () => {
		const before = plain("Amazing grace! How sweet the sound")
		const after = plain("amazing   GRACE how sweet the sound")
		expect(textDrift(before, after)).toBe(0)
	})

	it("reads the same words out of TTML, LRC, and plain text", () => {
		expect(textDrift(ttmlLines(), lrcLines())).toBe(0)
		expect(textDrift(lrcLines(), plain(PLAIN))).toBe(0)
	})

	it("counts appended words against the longer side", () => {
		const before = plain("a b c d e f g h")
		const after = plain("a b c d e f g h i j")
		expect(textDrift(before, after)).toBeCloseTo(0.2, 5)
	})

	describe("edge cases", () => {
		it("is 0 when both sides are empty", () => {
			expect(textDrift([], [])).toBe(0)
		})

		it("is 1 when every line is removed", () => {
			expect(textDrift(ttmlLines(), [])).toBe(1)
		})

		it("tokenizes CJK text without spaces into words", () => {
			const before = plain("私は歌を歌います")
			const after = plain("私は歌を歌いました")
			const drift = textDrift(before, after)
			expect(drift).toBeGreaterThan(0)
			expect(drift).toBeLessThan(0.5)
		})

		it("treats NFKC-equivalent fullwidth letters as the same word", () => {
			expect(textDrift(plain("ＡＢＣ song"), plain("abc song"))).toBe(0)
		})
	})

	describe("regressions", () => {
		it("regression: salami slicing is caught because every slice is measured against the anchor", () => {
			const anchor = lrcLines()
			let current = anchor
			const edits: Array<[number, string, string]> = [
				[0, "sweet", "soft"],
				[1, "wretch", "soul"],
				[2, "lost", "gone"],
				[4, "fear", "fright"],
				[5, "relieved", "released"],
				[8, "dangers", "perils"],
				[9, "already", "at last"],
				[12, "promised", "pledged"],
				[13, "hope", "faith"],
				[14, "shield", "strength"],
				[15, "endures", "remains"],
				[3, "blind", "dark"],
				[6, "precious", "dear"],
				[7, "hour", "day"],
				[10, "safe", "sound"],
			]
			const steps: number[] = []
			for (const [line, from, to] of edits) {
				const next = replaceWord(current, line, from, to)
				steps.push(textDrift(current, next))
				current = next
			}
			expect(Math.max(...steps)).toBeLessThan(0.03)
			expect(textDrift(anchor, current)).toBeGreaterThan(0.15)
		})

		it("regression: A to B to A returns to zero drift against the anchor", () => {
			const a = lrcLines()
			const b = replaceWord(replaceWord(a, 0, "sweet", "soft"), 1, "wretch", "soul")
			expect(textDrift(a, b)).toBeGreaterThan(0)
			expect(
				textDrift(
					a,
					a.map((line) => ({ ...line }))
				)
			).toBe(0)
		})

		it("regression: sitting just under the limit leaves no room for the next edit", () => {
			const before = plain(Array.from({ length: 100 }, (_, i) => `w${i}`).join(" "))
			const words = (n: number) =>
				plain(Array.from({ length: 100 }, (_, i) => (i < n ? `x${i}` : `w${i}`)).join(" "))
			expect(textDrift(before, words(15))).toBeCloseTo(0.15, 5)
			expect(textDrift(before, words(16))).toBeGreaterThan(0.15)
		})
	})

	describe("invariants", () => {
		it("is symmetric for equal-length edits", () => {
			const a = lrcLines()
			const b = replaceWord(a, 0, "sweet", "soft")
			expect(textDrift(a, b)).toBeCloseTo(textDrift(b, a), 10)
		})

		it("stays within 0 and 1", () => {
			const drift = textDrift(ttmlLines(), plain("completely different words here"))
			expect(drift).toBeGreaterThanOrEqual(0)
			expect(drift).toBeLessThanOrEqual(1)
		})

		it("does not mutate its inputs", () => {
			const a = lrcLines()
			const snapshot = JSON.stringify(a)
			textDrift(a, replaceWord(a, 0, "sweet", "soft"))
			expect(JSON.stringify(a)).toBe(snapshot)
		})
	})
})

describe("timingDrift", () => {
	it("is 0 for identical timing", () => {
		expect(timingDrift(ttmlLines(), ttmlLines())).toEqual({ drift: 0, offsetMs: 0 })
	})

	it("removes a uniform TTML offset and reports it", () => {
		const shifted = extractLines(shiftTtml(TTML, 3), "ttml")
		expect(timingDrift(ttmlLines(), shifted)).toEqual({ drift: 0, offsetMs: 3000 })
	})

	it("removes a uniform negative LRC offset", () => {
		const shifted = extractLines(
			shiftLrc(LRC, () => -750),
			"lrc"
		)
		expect(timingDrift(lrcLines(), shifted)).toEqual({ drift: 0, offsetMs: -750 })
	})

	it("catches a non-uniform retime of the whole song", () => {
		const retimed = extractLines(driftTtml(TTML, 12, 76, 8), "ttml")
		expect(timingDrift(ttmlLines(), retimed).drift).toBeGreaterThan(0.3)
	})

	it("counts only the lines that moved beyond the threshold", () => {
		const moved = new Set([2, 9])
		const retimed = extractLines(
			shiftLrc(LRC, (i) => (moved.has(i) ? 2500 : 0)),
			"lrc"
		)
		expect(timingDrift(lrcLines(), retimed)).toEqual({ drift: 2 / 16, offsetMs: 0 })
	})

	describe("edge cases", () => {
		it("is 0 when the anchor has no timing", () => {
			expect(timingDrift(plain(PLAIN), lrcLines())).toEqual({ drift: 0, offsetMs: 0 })
		})

		it("is 1 when a synced anchor loses all timing", () => {
			expect(timingDrift(lrcLines(), plain(PLAIN))).toEqual({ drift: 1, offsetMs: 0 })
		})

		it("ignores a nudge at exactly the threshold", () => {
			const retimed = extractLines(
				shiftLrc(LRC, (i) => (i === 0 ? 1000 : 0)),
				"lrc"
			)
			expect(timingDrift(lrcLines(), retimed).drift).toBe(0)
		})

		it("is 0 when no line text survives, leaving the change to text drift", () => {
			const other = plain("[00:12.00]nothing in common").map((l) => ({ ...l, startMs: 12000 }))
			expect(timingDrift(lrcLines(), other)).toEqual({ drift: 0, offsetMs: 0 })
		})
	})

	describe("regressions", () => {
		it("regression: a whole-lyric offset counts as zero timing drift", () => {
			for (const seconds of [-2, 0.5, 5]) {
				const shifted = extractLines(shiftTtml(TTML, seconds), "ttml")
				expect(timingDrift(ttmlLines(), shifted).drift).toBe(0)
			}
		})

		it("regression: an offset plus a few retimed lines only counts the retimed lines", () => {
			const retimed = extractLines(
				shiftLrc(LRC, (i) => (i === 5 ? 4000 : 1500)),
				"lrc"
			)
			expect(timingDrift(lrcLines(), retimed)).toEqual({ drift: 1 / 16, offsetMs: 1500 })
		})
	})

	describe("invariants", () => {
		it("stays within 0 and 1", () => {
			const { drift } = timingDrift(ttmlLines(), extractLines(driftTtml(TTML, 0, 90, 30), "ttml"))
			expect(drift).toBeGreaterThanOrEqual(0)
			expect(drift).toBeLessThanOrEqual(1)
		})
	})
})

describe("measureDrift", () => {
	it("combines text and timing against the same anchor", () => {
		const anchor = lrcLines()
		const edited = replaceWord(
			extractLines(
				shiftLrc(LRC, () => 2000),
				"lrc"
			),
			0,
			"sweet",
			"soft"
		)
		const drift = measureDrift(anchor, edited)
		expect(drift.text).toBeGreaterThan(0)
		expect(drift.timing).toBe(0)
		expect(drift.timingOffsetMs).toBe(2000)
	})
})

describe("normalizeLineText and wordTokens", () => {
	it("normalizes case, width, and whitespace", () => {
		expect(normalizeLineText("  Ｈｅｌｌｏ   World ")).toBe("hello world")
	})

	it("drops punctuation tokens", () => {
		expect(wordTokens(plain("Amazing grace! How sweet"))).toEqual([
			"amazing",
			"grace",
			"how",
			"sweet",
		])
	})
})
