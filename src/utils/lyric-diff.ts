import { config } from "@/config"
import type { DiffPart, DiffRow, HeadTextRef, MetadataField, SyllableChange } from "@/types"
import type { LyricLine } from "@/utils/extract-text"
import { createTwoFilesPatch, diffArrays } from "diff"

const SEGMENTS = new Intl.Segmenter(undefined, { granularity: "word" })

function wordParts(before: string, after: string): DiffPart[] {
	const a = Array.from(SEGMENTS.segment(before), (s) => s.segment)
	const b = Array.from(SEGMENTS.segment(after), (s) => s.segment)
	return diffArrays(a, b).map((change): DiffPart => {
		const op = change.added ? "+" : change.removed ? "-" : "="
		return [op, change.value.join("")]
	})
}

const headOf = (line: LyricLine): { head?: HeadTextRef } => (line.head ? { head: line.head } : {})

function timingShift(before: LyricLine, after: LyricLine): number | null {
	return before.startMs === null || after.startMs === null ? null : after.startMs - before.startMs
}

const isVisibleShift = (deltaMs: number): boolean =>
	Math.abs(deltaMs) >= config.revisions.minTimingChangeMs

const SYLLABLE_MARK = "·"

function markedText(line: LyricLine): string {
	if (!line.syllables) return line.text
	let out = ""
	let cursor = 0
	for (const [index, { text }] of line.syllables.entries()) {
		const at = line.text.indexOf(text, cursor)
		if (at === -1) return line.text
		const between = line.text.slice(cursor, at)
		out += index > 0 && between === "" ? SYLLABLE_MARK : between
		out += text
		cursor = at + text.length
	}
	return out + line.text.slice(cursor)
}

const splitText = (line: LyricLine): string | null => (line.syllables ? markedText(line) : null)

function sameSplit(before: LyricLine, after: LyricLine): boolean {
	const a = before.syllables
	const b = after.syllables
	if (!a || !b) return a === b
	return a.length === b.length && a.every((syllable, k) => syllable.text === b[k].text)
}

function movedSyllables(before: LyricLine, after: LyricLine): number {
	const lineShift = timingShift(before, after) ?? 0
	return (after.syllables ?? []).filter((syllable, k) => {
		const was = before.syllables?.[k]?.startMs ?? null
		if (was === null || syllable.startMs === null) return false
		const deltaMs = syllable.startMs - was
		return isVisibleShift(deltaMs) && isVisibleShift(deltaMs - lineShift)
	}).length
}

function syllableChange(before: LyricLine, after: LyricLine): SyllableChange | null {
	const resplit = !sameSplit(before, after)
	const moved = resplit ? 0 : movedSyllables(before, after)
	if (!resplit && moved === 0) return null
	return { before: splitText(before), after: splitText(after), moved }
}

function keptRow(before: LyricLine, after: LyricLine, lineNo: number): DiffRow {
	const syllables = syllableChange(before, after)
	const deltaMs = timingShift(before, after)
	if (deltaMs !== null && after.startMs !== null && isVisibleShift(deltaMs)) {
		const row = {
			kind: "timing",
			lineNo,
			startMs: after.startMs,
			deltaMs,
			text: after.text,
		} as const
		return syllables ? { ...row, syllables } : row
	}
	if (syllables)
		return { kind: "syllable", lineNo, startMs: after.startMs, text: after.text, ...syllables }
	return { kind: "same", lineNo, startMs: after.startMs, text: after.text, ...headOf(after) }
}

function collapseUnchanged(rows: DiffRow[], context: number, section?: "head"): DiffRow[] {
	const gap = (count: number): DiffRow =>
		section ? { kind: "gap", count, section } : { kind: "gap", count }
	const changed = rows.map((row) => row.kind !== "same")
	const nearChange = (index: number): boolean => {
		for (let d = -context; d <= context; d++) {
			if (changed[index + d]) return true
		}
		return false
	}
	const out: DiffRow[] = []
	let hidden = 0
	for (let index = 0; index < rows.length; index++) {
		if (nearChange(index)) {
			if (hidden > 0) out.push(gap(hidden))
			hidden = 0
			out.push(rows[index])
		} else {
			hidden++
		}
	}
	if (hidden > 0) out.push(gap(hidden))
	return out
}

function sectionRows(before: LyricLine[], after: LyricLine[]): DiffRow[] {
	const changes = diffArrays(
		before.map((line) => line.text),
		after.map((line) => line.text)
	)
	const rows: DiffRow[] = []
	let i = 0
	let j = 0
	let c = 0
	while (c < changes.length) {
		const change = changes[c]
		if (!change.added && !change.removed) {
			for (let k = 0; k < change.count; k++)
				rows.push(keptRow(before[i + k], after[j + k], j + k + 1))
			i += change.count
			j += change.count
			c++
		} else if (change.removed) {
			const next = changes[c + 1]
			const added = next?.added ? next.count : 0
			const paired = Math.min(change.count, added)
			for (let k = 0; k < paired; k++) {
				const line = after[j + k]
				const parts = wordParts(before[i + k].text, line.text)
				rows.push({
					kind: "word",
					lineNo: j + k + 1,
					startMs: line.startMs,
					parts,
					...headOf(line),
				})
			}
			for (let k = paired; k < change.count; k++) {
				const line = before[i + k]
				rows.push({
					kind: "del",
					lineNo: i + k + 1,
					startMs: line.startMs,
					text: line.text,
					...headOf(line),
				})
			}
			for (let k = paired; k < added; k++) {
				const line = after[j + k]
				rows.push({
					kind: "add",
					lineNo: j + k + 1,
					startMs: line.startMs,
					text: line.text,
					...headOf(line),
				})
			}
			i += change.count
			j += added
			c += added > 0 ? 2 : 1
		} else {
			for (let k = 0; k < change.count; k++) {
				const line = after[j + k]
				rows.push({
					kind: "add",
					lineNo: j + k + 1,
					startMs: line.startMs,
					text: line.text,
					...headOf(line),
				})
			}
			j += change.count
			c++
		}
	}
	return rows
}

export function buildDiffRows(before: LyricLine[], after: LyricLine[]): DiffRow[] {
	const isHead = (line: LyricLine) => line.head !== undefined
	const isBody = (line: LyricLine) => line.head === undefined
	const context = config.revisions.diffContextLines
	const body = collapseUnchanged(sectionRows(before.filter(isBody), after.filter(isBody)), context)
	const head = sectionRows(before.filter(isHead), after.filter(isHead))
	if (head.every((row) => row.kind === "same")) return body
	return [...body, ...collapseUnchanged(head, context, "head")]
}

function stamp(ms: number | null): string {
	if (ms === null) return ""
	const pad = (n: number) => String(n).padStart(2, "0")
	const minutes = Math.floor(ms / 60000)
	const seconds = Math.floor((ms % 60000) / 1000)
	const centis = Math.floor((ms % 1000) / 10)
	return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}] `
}

export function renderLinesForDiff(
	lines: LyricLine[],
	text: (line: LyricLine) => string = (line) => line.text
): string {
	const label = ({ head }: LyricLine) => {
		if (!head) return ""
		const where = head.line === null ? [] : [`L${head.line}`]
		return `[${[head.kind, head.lang ?? [], where].flat().join(" ")}] `
	}
	return lines.map((line) => `${stamp(line.startMs)}${label(line)}${text(line)}\n`).join("")
}

export function withoutSmallMoves(before: LyricLine[], after: LyricLine[]): LyricLine[] {
	const settled = [...after]
	let i = 0
	let j = 0
	for (const change of diffArrays(
		before.map((line) => line.text),
		after.map((line) => line.text)
	)) {
		if (change.added) {
			j += change.count
		} else if (change.removed) {
			i += change.count
		} else {
			for (let k = 0; k < change.count; k++) {
				const kept = after[j + k]
				const deltaMs = timingShift(before[i + k], kept)
				if (deltaMs !== null && !isVisibleShift(deltaMs)) {
					settled[j + k] = { ...kept, startMs: before[i + k].startMs }
				}
			}
			i += change.count
			j += change.count
		}
	}
	return settled
}

export function showsLineChanges(before: LyricLine[], after: LyricLine[]): boolean {
	return renderLinesForDiff(before) !== renderLinesForDiff(withoutSmallMoves(before, after))
}

export function showsChanges(before: LyricLine[], after: LyricLine[]): boolean {
	return (
		showsLineChanges(before, after) ||
		buildDiffRows(before, after).some((row) => row.kind === "syllable")
	)
}

type DiffLabels = { before: string; after: string }

function patch(labels: DiffLabels, before: string, after: string): string {
	return createTwoFilesPatch(labels.before, labels.after, before, after, undefined, undefined, {
		context: 3,
	})
}

export function unifiedDiff(before: LyricLine[], after: LyricLine[], labels: DiffLabels): string {
	return patch(
		labels,
		renderLinesForDiff(before),
		renderLinesForDiff(withoutSmallMoves(before, after))
	)
}

export interface FieldChange {
	field: MetadataField
	before: string | null
	after: string | null
}

const FIELD_ORDER: MetadataField[] = ["language", "isrc", "album"]

const isChanged = (change: FieldChange): boolean => change.before !== change.after

export function buildFieldRows(changes: FieldChange[]): DiffRow[] {
	return changes
		.filter(isChanged)
		.sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field))
		.map(({ field, before, after }) => ({ kind: "field", field, before, after }))
}

function renderFields(changes: FieldChange[], side: "before" | "after"): string {
	return changes
		.filter((change) => isChanged(change) && change[side] !== null)
		.map((change) => `[${change.field}] ${change[side]}\n`)
		.join("")
}

const SMALL_MOVES_NOTE = `Timing changed slightly, no line moved by ${config.revisions.minTimingChangeMs} ms or more.`

function syllableTimingNote(before: LyricLine[], after: LyricLine[]): string | null {
	const lines = buildDiffRows(before, after).filter((row) => {
		if (row.kind !== "syllable" && row.kind !== "timing") return false
		const change = row.kind === "syllable" ? row : row.syllables
		return change !== undefined && (change.before ?? row.text) === (change.after ?? row.text)
	}).length
	if (lines === 0) return null
	return `Syllable timing changed on ${lines} ${lines === 1 ? "line" : "lines"}.`
}

export function reviewDiff(
	before: LyricLine[],
	after: LyricLine[],
	fields: FieldChange[],
	labels: DiffLabels
): { full: string; preview: string } {
	const full = patch(
		labels,
		renderFields(fields, "before") + renderLinesForDiff(before, markedText),
		renderFields(fields, "after") + renderLinesForDiff(withoutSmallMoves(before, after), markedText)
	)
	const onlySmallMoves =
		renderLinesForDiff(before) !== renderLinesForDiff(after) && !showsChanges(before, after)
	const notes = [
		onlySmallMoves ? SMALL_MOVES_NOTE : null,
		syllableTimingNote(before, after),
	].filter((note) => note !== null)
	return {
		full: notes.reduce((text, note) => `${text}${note}\n`, full),
		preview: [diffPreview(full), ...notes].filter(Boolean).join("\n"),
	}
}

export function diffPreview(unified: string): string {
	const lines = unified.split("\n")
	const firstHunk = lines.findIndex((line) => line.startsWith("@@"))
	if (firstHunk === -1) return ""
	return lines
		.slice(firstHunk)
		.filter((line) => line.startsWith("+") || line.startsWith("-"))
		.slice(0, config.revisions.diffPreviewLines)
		.join("\n")
}
