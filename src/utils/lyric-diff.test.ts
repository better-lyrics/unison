import { config } from "@/config"
import { AMAZING_GRACE_SPANISH, readRevisionFixture, withTranslation } from "@/test/lyric-fixtures"
import type { DiffRow } from "@/types"
import { type LyricLine, extractComparableLines, extractLines } from "@/utils/extract-text"
import { describe, expect, it } from "vitest"
import {
	type FieldChange,
	buildDiffRows,
	buildFieldRows,
	diffPreview,
	renderLinesForDiff,
	reviewDiff,
	showsChanges,
	unifiedDiff,
} from "./lyric-diff"

const LRC = readRevisionFixture("amazing-grace.lrc")
const REEXPORT_BEFORE = ttmlLinesOf("90210-before.ttml")
const REEXPORT_AFTER = ttmlLinesOf("90210-after.ttml")
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

function ttmlLinesOf(name: string): LyricLine[] {
	return extractComparableLines(readRevisionFixture(name), "ttml")
}

function shiftEvery(lines: LyricLine[], deltaMs: number): LyricLine[] {
	return lines.map((line) =>
		line.startMs === null ? line : { ...line, startMs: line.startMs + deltaMs }
	)
}

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

describe("minimum timing change", () => {
	const shifted = (deltaMs: number) => edit(base(), 0, { startMs: 12000 + deltaMs })
	const firstRow = (deltaMs: number) => buildDiffRows(base(), shifted(deltaMs))[0]

	it("is 100 ms", () => {
		expect(config.revisions.minTimingChangeMs).toBe(100)
	})

	it("shows a line moved by exactly the minimum as a timing row", () => {
		expect(firstRow(100)).toEqual({
			kind: "timing",
			lineNo: 1,
			startMs: 12100,
			deltaMs: 100,
			text: "Amazing grace! How sweet the sound",
		})
	})

	it("shows a line moved by just over the minimum as a timing row", () => {
		expect(firstRow(101)).toMatchObject({ kind: "timing", deltaMs: 101 })
		expect(firstRow(-101)).toMatchObject({ kind: "timing", deltaMs: -101 })
	})

	it("shows a line moved earlier by exactly the minimum as a timing row", () => {
		expect(firstRow(-100)).toMatchObject({ kind: "timing", deltaMs: -100 })
	})

	it("treats a line moved by just under the minimum as unchanged", () => {
		expect(buildDiffRows(base(), shifted(99))).toEqual([{ kind: "gap", count: 16 }])
		expect(buildDiffRows(base(), shifted(-99))).toEqual([{ kind: "gap", count: 16 }])
	})

	it("keeps the unified diff empty for a move under the minimum", () => {
		const full = unifiedDiff(base(), shifted(99), { before: "a", after: "b" })
		expect(diffPreview(full)).toBe("")
	})

	it("lists a move of at least the minimum in the unified diff", () => {
		const full = unifiedDiff(base(), shifted(100), { before: "a", after: "b" })
		expect(diffPreview(full)).toBe(
			"-[00:12.00] Amazing grace! How sweet the sound\n+[00:12.10] Amazing grace! How sweet the sound"
		)
	})

	describe("showsChanges", () => {
		it("is false for identical lines", () => {
			expect(showsChanges(base(), base())).toBe(false)
		})

		it("is false when every line only moves under the minimum", () => {
			expect(showsChanges(base(), shiftEvery(base(), 10))).toBe(false)
			expect(showsChanges(base(), shiftEvery(base(), -99))).toBe(false)
		})

		it("is true when a line moves by the minimum", () => {
			expect(showsChanges(base(), shifted(100))).toBe(true)
		})

		it("is true when text changes", () => {
			expect(showsChanges(base(), edit(base(), 3, { text: "Was dark, but now I see." }))).toBe(true)
		})

		it("is true when a line is added or removed", () => {
			expect(showsChanges(base(), base().slice(1))).toBe(true)
			expect(showsChanges(base().slice(1), base())).toBe(true)
		})
	})

	describe("edge cases", () => {
		it("keeps a line that gains or loses its time as unchanged", () => {
			const untimed = edit(base(), 0, { startMs: null })
			expect(buildDiffRows(base(), untimed)[0]).toEqual({ kind: "gap", count: 16 })
			expect(buildDiffRows(untimed, base())[0]).toEqual({ kind: "gap", count: 16 })
		})

		it("still lists a line that loses its time in the unified diff", () => {
			const untimed = edit(base(), 0, { startMs: null })
			const full = unifiedDiff(base(), untimed, { before: "a", after: "b" })
			expect(diffPreview(full)).toBe(
				"-[00:12.00] Amazing grace! How sweet the sound\n+Amazing grace! How sweet the sound"
			)
			expect(showsChanges(base(), untimed)).toBe(true)
			expect(showsChanges(untimed, base())).toBe(true)
		})

		it("still shows a text change on a line that also moved under the minimum", () => {
			const after = edit(base(), 0, { startMs: 12050, text: "Amazing grace! How soft the sound" })
			expect(buildDiffRows(base(), after)[0]).toMatchObject({ kind: "word", startMs: 12050 })
		})

		it("shows the real start time for a moved line after an unchanged neighbour", () => {
			const after = edit(shiftEvery(base(), 40), 5, { startMs: 33500 })
			const timing = buildDiffRows(base(), after).filter((row) => row.kind === "timing")
			expect(timing).toEqual([
				{
					kind: "timing",
					lineNo: 6,
					startMs: 33500,
					deltaMs: 500,
					text: base()[5].text,
				},
			])
		})
	})

	describe("regressions", () => {
		it("regression: a TTML Composer re-export that moves lines by 1 ms shows no timing rows", () => {
			const rows = buildDiffRows(REEXPORT_BEFORE, REEXPORT_AFTER)
			expect(rows.filter((row) => row.kind === "timing")).toEqual([])
		})

		it("regression: the re-export still shows its one real text change", () => {
			const rows = buildDiffRows(REEXPORT_BEFORE, REEXPORT_AFTER)
			expect(rows.filter((row) => row.kind !== "same" && row.kind !== "gap")).toEqual([
				expect.objectContaining({ kind: "word", lineNo: 35 }),
			])
		})

		it("regression: the re-export unified diff lists only the real text change", () => {
			const full = unifiedDiff(REEXPORT_BEFORE, REEXPORT_AFTER, { before: "a", after: "b" })
			expect(diffPreview(full)).toBe(
				"-[03:51.58] salary, we 'bout to cap, bitch\n+[03:50.31] I'ma sell it, your niggas salary, we 'bout to cap, bitch"
			)
		})

		it("regression: 1 ms jitter on every line shows no changes", () => {
			expect(buildDiffRows(base(), shiftEvery(base(), -1))).toEqual([{ kind: "gap", count: 16 }])
			expect(showsChanges(REEXPORT_BEFORE, shiftEvery(REEXPORT_BEFORE, 1))).toBe(false)
		})
	})

	describe("invariants", () => {
		it("never emits a timing row smaller than the minimum", () => {
			for (const delta of [-150, -100, -99, -1, 0, 1, 50, 99, 100, 150]) {
				const after = shiftEvery(base(), delta)
				for (const row of buildDiffRows(base(), after)) {
					if (row.kind === "timing") {
						expect(Math.abs(row.deltaMs)).toBeGreaterThanOrEqual(config.revisions.minTimingChangeMs)
					}
				}
			}
		})

		it("does not mutate its inputs", () => {
			const before = base()
			const after = shiftEvery(base(), 30)
			const snapshot = structuredClone(after)
			unifiedDiff(before, after, { before: "a", after: "b" })
			showsChanges(before, after)
			expect(after).toEqual(snapshot)
		})
	})
})

describe("reviewDiff", () => {
	const labels = { before: "rev 1", after: "rev 2" }
	const unchanged: FieldChange[] = [
		{ field: "language", before: "en", after: "en" },
		{ field: "isrc", before: null, after: null },
		{ field: "album", before: "Hymns", after: "Hymns" },
	]
	const shiftedBy = (deltaMs: number) => shiftEvery(base(), deltaMs)

	it("matches the unified diff when only lyric lines changed", () => {
		const after = edit(base(), 1, { text: "That saved a soul like me!" })
		const review = reviewDiff(base(), after, unchanged, labels)
		expect(review.full).toBe(unifiedDiff(base(), after, labels))
		expect(review.preview).toBe(diffPreview(review.full))
	})

	it("shows a changed album as labelled lines", () => {
		const changes: FieldChange[] = [{ field: "album", before: "Hymns", after: "Sacred Songs" }]
		const review = reviewDiff(base(), base(), changes, labels)
		expect(review.preview).toBe("-[album] Hymns\n+[album] Sacred Songs")
		expect(review.full).toContain("-[album] Hymns\n+[album] Sacred Songs\n")
	})

	it("shows a set and a cleared field with one side only", () => {
		const changes: FieldChange[] = [
			{ field: "language", before: "en", after: null },
			{ field: "isrc", before: null, after: "USRC17607839" },
		]
		expect(reviewDiff(base(), base(), changes, labels).preview).toBe(
			"-[language] en\n+[isrc] USRC17607839"
		)
	})

	it("says timing changed slightly when every move is under the minimum", () => {
		const review = reviewDiff(base(), shiftedBy(50), unchanged, labels)
		expect(review.preview).toBe("Timing changed slightly, no line moved by 100 ms or more.")
		expect(
			review.full.endsWith("Timing changed slightly, no line moved by 100 ms or more.\n")
		).toBe(true)
	})

	it("shows field changes and the timing line together", () => {
		const changes: FieldChange[] = [{ field: "album", before: "Hymns", after: null }]
		expect(reviewDiff(base(), shiftedBy(50), changes, labels).preview).toBe(
			"-[album] Hymns\nTiming changed slightly, no line moved by 100 ms or more."
		)
	})

	describe("edge cases", () => {
		it("is empty when nothing changed", () => {
			expect(reviewDiff(base(), base(), unchanged, labels).preview).toBe("")
		})

		it("adds no timing line when a move reaches the minimum", () => {
			const review = reviewDiff(base(), edit(base(), 0, { startMs: 12100 }), unchanged, labels)
			expect(review.preview).not.toContain("Timing changed slightly")
			expect(review.preview).toContain("+[00:12.10] Amazing grace! How sweet the sound")
		})

		it("adds no timing line when text changed alongside small moves", () => {
			const after = edit(shiftedBy(50), 0, { text: "Amazing grace! How soft the sound" })
			expect(reviewDiff(base(), after, unchanged, labels).preview).not.toContain("Timing changed")
		})

		it("is empty for identical untimed lyrics", () => {
			const plain = base().map((line) => ({ ...line, startMs: null }))
			expect(reviewDiff(plain, plain, unchanged, labels).preview).toBe("")
		})
	})

	describe("invariants", () => {
		it("never lists an unchanged field", () => {
			const review = reviewDiff(base(), base().slice(1), unchanged, labels)
			expect(review.full).not.toContain("[album]")
			expect(review.full).not.toContain("[language]")
		})

		it("never uses a dash in the timing line", () => {
			const { preview } = reviewDiff(base(), shiftedBy(30), unchanged, labels)
			expect(preview).not.toMatch(/[-\u2013\u2014]/)
		})
	})
})

describe("buildFieldRows", () => {
	it("returns a field row for a changed album", () => {
		expect(buildFieldRows([{ field: "album", before: "Hymns", after: "Sacred Songs" }])).toEqual([
			{ kind: "field", field: "album", before: "Hymns", after: "Sacred Songs" },
		])
	})

	it("leaves out fields whose value did not change", () => {
		expect(
			buildFieldRows([
				{ field: "language", before: "en", after: "en" },
				{ field: "isrc", before: null, after: "USRC17607839" },
				{ field: "album", before: "Hymns", after: "Hymns" },
			])
		).toEqual([{ kind: "field", field: "isrc", before: null, after: "USRC17607839" }])
	})

	it("orders rows language, isrc, album whatever order the changes come in", () => {
		const rows = buildFieldRows([
			{ field: "album", before: null, after: "Sacred Songs" },
			{ field: "isrc", before: "GBAYE0400001", after: "USRC17607839" },
			{ field: "language", before: "en", after: "es" },
		])
		expect(rows.map((row) => (row.kind === "field" ? row.field : row.kind))).toEqual([
			"language",
			"isrc",
			"album",
		])
	})

	describe("edge cases", () => {
		it("returns no rows for no changes", () => {
			expect(buildFieldRows([])).toEqual([])
		})

		it("returns no rows when a field stays empty", () => {
			expect(buildFieldRows([{ field: "isrc", before: null, after: null }])).toEqual([])
		})

		it("keeps a cleared field with a null after", () => {
			expect(buildFieldRows([{ field: "language", before: "en", after: null }])).toEqual([
				{ kind: "field", field: "language", before: "en", after: null },
			])
		})

		it("counts a case-only album change as a change", () => {
			expect(buildFieldRows([{ field: "album", before: "Hymns", after: "hymns" }])).toHaveLength(1)
		})

		it("keeps unicode values intact", () => {
			expect(
				buildFieldRows([{ field: "album", before: null, after: "今すぐ輪廻 (Beyoncé Remix)" }])
			).toEqual([
				{ kind: "field", field: "album", before: null, after: "今すぐ輪廻 (Beyoncé Remix)" },
			])
		})
	})

	describe("invariants", () => {
		const changes: FieldChange[] = [
			{ field: "album", before: "Hymns", after: "Sacred Songs" },
			{ field: "language", before: "en", after: "es" },
		]

		it("does not modify the changes it is given", () => {
			const copy = structuredClone(changes)
			buildFieldRows(changes)
			expect(changes).toEqual(copy)
		})

		it("never returns a row whose before equals its after", () => {
			for (const row of buildFieldRows([...changes, { field: "isrc", before: "x", after: "x" }])) {
				expect(row.kind === "field" && row.before !== row.after).toBe(true)
			}
		})

		it("agrees with the council card on which fields changed", () => {
			const all: FieldChange[] = [
				...changes,
				{ field: "isrc", before: "USRC17607839", after: "USRC17607839" },
			]
			const review = reviewDiff(base(), base(), all, { before: "a", after: "b" })
			const carded = ["language", "isrc", "album"].filter((field) =>
				review.full.includes(`[${field}]`)
			)
			expect(buildFieldRows(all).map((row) => (row.kind === "field" ? row.field : ""))).toEqual(
				carded
			)
		})
	})
})
