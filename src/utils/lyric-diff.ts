import { config } from "@/config"
import type { DiffPart, DiffRow } from "@/types"
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

function keptRow(before: LyricLine, after: LyricLine, lineNo: number): DiffRow {
	if (before.startMs !== null && after.startMs !== null && before.startMs !== after.startMs) {
		return {
			kind: "timing",
			lineNo,
			startMs: after.startMs,
			deltaMs: after.startMs - before.startMs,
			text: after.text,
		}
	}
	return { kind: "same", lineNo, startMs: after.startMs, text: after.text }
}

function collapseUnchanged(rows: DiffRow[], context: number): DiffRow[] {
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
			if (hidden > 0) out.push({ kind: "gap", count: hidden })
			hidden = 0
			out.push(rows[index])
		} else {
			hidden++
		}
	}
	if (hidden > 0) out.push({ kind: "gap", count: hidden })
	return out
}

export function buildDiffRows(before: LyricLine[], after: LyricLine[]): DiffRow[] {
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
				rows.push({ kind: "word", lineNo: j + k + 1, startMs: line.startMs, parts })
			}
			for (let k = paired; k < change.count; k++) {
				const line = before[i + k]
				rows.push({ kind: "del", lineNo: i + k + 1, startMs: line.startMs, text: line.text })
			}
			for (let k = paired; k < added; k++) {
				const line = after[j + k]
				rows.push({ kind: "add", lineNo: j + k + 1, startMs: line.startMs, text: line.text })
			}
			i += change.count
			j += added
			c += added > 0 ? 2 : 1
		} else {
			for (let k = 0; k < change.count; k++) {
				const line = after[j + k]
				rows.push({ kind: "add", lineNo: j + k + 1, startMs: line.startMs, text: line.text })
			}
			j += change.count
			c++
		}
	}
	return collapseUnchanged(rows, config.revisions.diffContextLines)
}

function stamp(ms: number | null): string {
	if (ms === null) return ""
	const pad = (n: number) => String(n).padStart(2, "0")
	const minutes = Math.floor(ms / 60000)
	const seconds = Math.floor((ms % 60000) / 1000)
	const centis = Math.floor((ms % 1000) / 10)
	return `[${pad(minutes)}:${pad(seconds)}.${pad(centis)}] `
}

export function renderLinesForDiff(lines: LyricLine[]): string {
	const label = (line: LyricLine) => (line.key ? `[${line.key}] ` : "")
	return lines.map((line) => `${stamp(line.startMs)}${label(line)}${line.text}\n`).join("")
}

export function unifiedDiff(
	before: LyricLine[],
	after: LyricLine[],
	labels: { before: string; after: string }
): string {
	return createTwoFilesPatch(
		labels.before,
		labels.after,
		renderLinesForDiff(before),
		renderLinesForDiff(after),
		undefined,
		undefined,
		{ context: 3 }
	)
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
