import { readRevisionFixture } from "@/test/lyric-fixtures"
import { type LyricLine, extractLines } from "@/utils/extract-text"
import { describe, expect, it } from "vitest"
import { buildDiffRows, diffPreview, renderLinesForDiff, unifiedDiff } from "./lyric-diff"

const LRC = readRevisionFixture("amazing-grace.lrc")
const base = () => extractLines(LRC, "lrc")

function edit(lines: LyricLine[], index: number, patch: Partial<LyricLine>): LyricLine[] {
	return lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
}

describe("buildDiffRows", () => {
	it("collapses an unchanged lyric into one gap", () => {
		expect(buildDiffRows(base(), base())).toEqual([{ kind: "gap", count: 16 }])
	})

	it("shows a changed word with two lines of context and gaps around it", () => {
		const after = edit(base(), 8, { text: "Through many perils, toils and snares," })
		const rows = buildDiffRows(base(), after)
		expect(rows[0]).toEqual({ kind: "gap", count: 6 })
		expect(rows[3]).toEqual({
			kind: "word",
			lineNo: 9,
			startMs: 46000,
			parts: [
				["=", "Through many "],
				["-", "dangers"],
				["+", "perils"],
				["=", ", toils and snares,"],
			],
		})
		expect(rows.at(-1)).toEqual({ kind: "gap", count: 5 })
	})

	it("marks a retimed line as a timing row", () => {
		const after = edit(base(), 0, { startMs: 12500 })
		expect(buildDiffRows(base(), after)[0]).toEqual({
			kind: "timing",
			lineNo: 1,
			startMs: 12500,
			deltaMs: 500,
			text: "Amazing grace! How sweet the sound",
		})
	})

	it("emits add and del rows for unpaired lines", () => {
		const before = base().slice(0, 2)
		const after = [...before, { text: "A new closing line", startMs: 20000 }]
		expect(buildDiffRows(before, after).at(-1)).toEqual({
			kind: "add",
			lineNo: 3,
			startMs: 20000,
			text: "A new closing line",
		})
		expect(buildDiffRows(after, before).at(-1)).toEqual({
			kind: "del",
			lineNo: 3,
			startMs: 20000,
			text: "A new closing line",
		})
	})

	describe("edge cases", () => {
		it("returns no rows for two empty sides", () => {
			expect(buildDiffRows([], [])).toEqual([])
		})

		it("shows every line as added against an empty predecessor", () => {
			const rows = buildDiffRows([], base().slice(0, 2))
			expect(rows.map((row) => row.kind)).toEqual(["add", "add"])
		})

		it("shows a case-only change as a word change", () => {
			const after = edit(base(), 0, { text: "amazing grace! How sweet the sound" })
			expect(buildDiffRows(base(), after)[0].kind).toBe("word")
		})
	})

	describe("invariants", () => {
		it("accounts for every line of the newer side exactly once", () => {
			const after = edit(edit(base(), 3, { text: "Was dark, but now I see." }), 10, {
				startMs: 90000,
			})
			const rows = buildDiffRows(base(), after)
			const shown = rows.reduce(
				(n, row) => n + (row.kind === "gap" ? row.count : row.kind === "del" ? 0 : 1),
				0
			)
			expect(shown).toBe(after.length)
		})
	})
})

describe("unifiedDiff and diffPreview", () => {
	it("renders timed lines with LRC stamps", () => {
		expect(renderLinesForDiff(base().slice(0, 1))).toBe(
			"[00:12.00] Amazing grace! How sweet the sound\n"
		)
	})

	it("labels TTML head text with its key so a translation lines up with its line", () => {
		const before = [{ key: "translation es L2", text: "Que salvó a un desdichado", startMs: null }]
		const after = [{ key: "translation es L2", text: "Que salvó a un alma", startMs: null }]
		expect(renderLinesForDiff(after)).toBe("[translation es L2] Que salvó a un alma\n")
		expect(diffPreview(unifiedDiff(before, after, { before: "a", after: "b" }))).toBe(
			"-[translation es L2] Que salvó a un desdichado\n+[translation es L2] Que salvó a un alma"
		)
	})

	it("produces a unified diff whose preview lists only changed lines", () => {
		const after = edit(base(), 1, { text: "That saved a soul like me!" })
		const full = unifiedDiff(base(), after, { before: "rev 1", after: "rev 2" })
		expect(full).toContain("--- rev 1")
		expect(full).toContain("+++ rev 2")
		expect(diffPreview(full)).toBe(
			"-[00:16.00] That saved a wretch like me!\n+[00:16.00] That saved a soul like me!"
		)
	})

	it("caps the preview at six changed lines", () => {
		let after = base()
		for (let i = 0; i < 10; i++) after = edit(after, i, { text: `changed ${i}` })
		const preview = diffPreview(unifiedDiff(base(), after, { before: "a", after: "b" }))
		expect(preview.split("\n")).toHaveLength(6)
	})

	describe("edge cases", () => {
		it("gives an empty preview when nothing changed", () => {
			expect(diffPreview(unifiedDiff(base(), base(), { before: "a", after: "b" }))).toBe("")
		})

		it("regression: keeps a lyric line that itself starts with dashes", () => {
			const before = [{ text: "-- intro --", startMs: null }]
			const after = [{ text: "-- outro --", startMs: null }]
			expect(diffPreview(unifiedDiff(before, after, { before: "a", after: "b" }))).toBe(
				"--- intro --\n+-- outro --"
			)
		})
	})
})
