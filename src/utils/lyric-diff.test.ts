import { AMAZING_GRACE_SPANISH, readRevisionFixture, withTranslation } from "@/test/lyric-fixtures"
import type { DiffRow } from "@/types"
import { type LyricLine, extractComparableLines, extractLines } from "@/utils/extract-text"
import { describe, expect, it } from "vitest"
import { buildDiffRows, diffPreview, renderLinesForDiff, unifiedDiff } from "./lyric-diff"

const LRC = readRevisionFixture("amazing-grace.lrc")
const base = () => extractLines(LRC, "lrc")
const TTML = readRevisionFixture("amazing-grace.ttml")
const SPANISH_TTML = withTranslation(TTML, "es", AMAZING_GRACE_SPANISH)
const ttmlLines = (ttml: string) => extractComparableLines(ttml, "ttml")
const headRows = (rows: DiffRow[]) => rows.filter((row) => "head" in row)
const retranslate = (index: number, text: string) =>
	withTranslation(
		TTML,
		"es",
		AMAZING_GRACE_SPANISH.map((line, i) => (i === index ? text : line))
	)
const withRomaji = (ttml: string, lines: string[]) =>
	ttml.replace(
		"</iTunesMetadata>",
		`<transliterations><transliteration xml:lang="en-Latn">${lines.map((text, i) => `<text for="L${i + 1}">${text}</text>`).join("")}</transliteration></transliterations></iTunesMetadata>`
	)

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

describe("buildDiffRows with TTML head text", () => {
	it("shows a head-only translation edit as body gaps and a head word row", () => {
		const rows = buildDiffRows(
			ttmlLines(SPANISH_TTML),
			ttmlLines(retranslate(1, "Que salvó a un alma como yo"))
		)
		expect(rows[0]).toEqual({ kind: "gap", count: 16 })
		expect(rows.filter((row) => row.kind === "word")).toEqual([
			{
				kind: "word",
				lineNo: 3,
				startMs: null,
				head: { kind: "translation", lang: "es", line: 2 },
				parts: [
					["=", "Que salvó a un "],
					["-", "desdichado"],
					["+", "alma"],
					["=", " como yo"],
				],
			},
		])
		expect(rows.slice(1, 4)).toEqual([
			{
				kind: "same",
				lineNo: 1,
				startMs: null,
				head: { kind: "credit", lang: null, line: null },
				text: "John Newton",
			},
			{
				kind: "same",
				lineNo: 2,
				startMs: null,
				head: { kind: "translation", lang: "es", line: 1 },
				text: AMAZING_GRACE_SPANISH[0],
			},
			expect.objectContaining({ kind: "word" }),
		])
		expect(rows.at(-1)).toEqual({ kind: "gap", count: 12, section: "head" })
	})

	it("marks head gaps before and after the first changed head row", () => {
		const rows = buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(retranslate(10, "Es la gracia")))
		const head = rows.slice(1)
		expect(head[0]).toEqual({ kind: "gap", count: 9, section: "head" })
		expect(head[3]).toMatchObject({ kind: "word", lineNo: 12 })
		expect(head.at(-1)).toEqual({ kind: "gap", count: 3, section: "head" })
	})

	it("shows an added transliteration block as head add rows", () => {
		const romaji = ["Amazing grace", "That saved"]
		const rows = buildDiffRows(ttmlLines(TTML), ttmlLines(withRomaji(TTML, romaji)))
		expect(rows.filter((row) => row.kind === "add")).toEqual([
			{
				kind: "add",
				lineNo: 2,
				startMs: null,
				head: { kind: "transliteration", lang: "en-Latn", line: 1 },
				text: "Amazing grace",
			},
			{
				kind: "add",
				lineNo: 3,
				startMs: null,
				head: { kind: "transliteration", lang: "en-Latn", line: 2 },
				text: "That saved",
			},
		])
	})

	it("shows a songwriter change as a credit row", () => {
		const after = TTML.replace("John Newton", "John Newton, Edwin Excell")
		const [row] = headRows(buildDiffRows(ttmlLines(TTML), ttmlLines(after)))
		expect(row).toMatchObject({
			kind: "word",
			lineNo: 1,
			startMs: null,
			head: { kind: "credit", lang: null, line: null },
		})
	})

	it("shows a removed translation block as head del rows from the older side", () => {
		const rows = headRows(buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(TTML))).filter(
			(row) => row.kind === "del"
		)
		expect(rows).toHaveLength(AMAZING_GRACE_SPANISH.length)
		expect(rows[0]).toEqual({
			kind: "del",
			lineNo: 2,
			startMs: null,
			head: { kind: "translation", lang: "es", line: 1 },
			text: AMAZING_GRACE_SPANISH[0],
		})
	})

	describe("edge cases", () => {
		it("returns no head rows for LRC, plain text, or TTML without a head", () => {
			const plain = readRevisionFixture("amazing-grace.txt")
			const bare = TTML.replace(/<head>.*<\/head>/s, "")
			for (const [before, after] of [
				[
					extractComparableLines(LRC, "lrc"),
					edit(extractComparableLines(LRC, "lrc"), 0, { text: "x" }),
				],
				[
					extractComparableLines(plain, "plain"),
					extractComparableLines(`${plain}\nextra`, "plain"),
				],
				[ttmlLines(bare), ttmlLines(bare.replace("sweet", "soft"))],
			]) {
				expect(headRows(buildDiffRows(before, after))).toEqual([])
			}
		})

		it("adds no head rows when only the body changed", () => {
			const after = SPANISH_TTML.replace("sweet", "soft")
			expect(headRows(buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(after)))).toEqual([])
		})
	})

	describe("regressions", () => {
		it("regression: body gaps never carry a section", () => {
			const after = retranslate(10, "Es la gracia").replace("dangers", "perils")
			const rows = buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(after))
			const firstHead = rows.findIndex((row) => "head" in row || "section" in row)
			const bodyGaps = rows.slice(0, firstHead).filter((row) => row.kind === "gap")
			expect(bodyGaps.length).toBeGreaterThan(0)
			for (const gap of bodyGaps) expect(gap).not.toHaveProperty("section")
			expect(buildDiffRows(base(), edit(base(), 8, { text: "x" }))[0]).toEqual({
				kind: "gap",
				count: 6,
			})
		})

		it("regression: body rows are the same as a body-only diff", () => {
			const after = retranslate(1, "Que salvó a un alma como yo")
				.replace("sweet", "soft")
				.replace(
					'begin="16.000" end="19.600" itunes:key="L2"',
					'begin="16.400" end="19.600" itunes:key="L2"'
				)
			const rows = buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(after))
			const bodyOnly = buildDiffRows(
				extractLines(SPANISH_TTML, "ttml"),
				extractLines(after, "ttml")
			)
			expect(rows.slice(0, bodyOnly.length)).toEqual(bodyOnly)
			expect(
				rows
					.slice(bodyOnly.length)
					.every((row) => (row.kind === "gap" ? row.section === "head" : "head" in row))
			).toBe(true)
		})
	})

	describe("invariants", () => {
		it("never gives a head row a start time or a timing kind", () => {
			const after = withRomaji(retranslate(4, "otra línea"), ["uno"])
				.replace("John Newton", "J. Newton")
				.replace(/begin="12\.000"/g, 'begin="12.500"')
			const rows = headRows(buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(after)))
			expect(rows.length).toBeGreaterThan(0)
			for (const row of rows) {
				expect(row.kind).not.toBe("timing")
				expect("startMs" in row && row.startMs).toBeNull()
			}
		})

		it("numbers head rows by their position within the head section", () => {
			const rows = buildDiffRows(ttmlLines(SPANISH_TTML), ttmlLines(retranslate(15, "fin")))
			expect(headRows(rows).find((row) => row.kind === "word")).toMatchObject({ lineNo: 17 })
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
		const head = { kind: "translation", lang: "es", line: 2 } as const
		const before = [{ head, text: "Que salvó a un desdichado", startMs: null }]
		const after = [{ head, text: "Que salvó a un alma", startMs: null }]
		expect(renderLinesForDiff(after)).toBe("[translation es L2] Que salvó a un alma\n")
		expect(diffPreview(unifiedDiff(before, after, { before: "a", after: "b" }))).toBe(
			"-[translation es L2] Que salvó a un desdichado\n+[translation es L2] Que salvó a un alma"
		)
	})

	it("labels a credit and a line-less transliteration from their head metadata", () => {
		expect(
			renderLinesForDiff([
				{ head: { kind: "credit", lang: null, line: null }, text: "John Newton", startMs: null },
				{
					head: { kind: "transliteration", lang: "ja-Latn", line: null },
					text: "kimi no koe",
					startMs: null,
				},
			])
		).toBe("[credit] John Newton\n[transliteration ja-Latn] kimi no koe\n")
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
