import { config } from "@/config"
import type { LyricLine } from "@/utils/extract-text"
import { diffArrays } from "diff"

export interface DriftResult {
	text: number
	timing: number
	timingOffsetMs: number
}

type TimedLine = LyricLine & { startMs: number }

const WORDS = new Intl.Segmenter(undefined, { granularity: "word" })

export function normalizeLineText(text: string): string {
	return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
}

export function wordTokens(lines: LyricLine[]): string[] {
	const tokens: string[] = []
	for (const line of lines) {
		for (const { segment, isWordLike } of WORDS.segment(normalizeLineText(line.text))) {
			if (isWordLike) tokens.push(segment)
		}
	}
	return tokens
}

function keptPairs(before: string[], after: string[]): Array<[number, number]> | null {
	const changes = diffArrays(before, after, { maxEditLength: config.revisions.maxDiffEdits })
	if (!changes) return null
	const pairs: Array<[number, number]> = []
	let i = 0
	let j = 0
	for (const change of changes) {
		if (change.added) {
			j += change.count
		} else if (change.removed) {
			i += change.count
		} else {
			for (let k = 0; k < change.count; k++) pairs.push([i + k, j + k])
			i += change.count
			j += change.count
		}
	}
	return pairs
}

export function textDrift(anchor: LyricLine[], candidate: LyricLine[]): number {
	const before = wordTokens(anchor)
	const after = wordTokens(candidate)
	const longest = Math.max(before.length, after.length)
	if (longest === 0) return 0
	const kept = keptPairs(before, after)
	if (kept === null) return 1
	return 1 - kept.length / longest
}

function isTimed(line: LyricLine): line is TimedLine {
	return line.startMs !== null
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function timingDrift(
	anchor: LyricLine[],
	candidate: LyricLine[]
): { drift: number; offsetMs: number } {
	const before = anchor.filter(isTimed)
	if (before.length === 0) return { drift: 0, offsetMs: 0 }
	const after = candidate.filter(isTimed)
	if (after.length === 0) return { drift: 1, offsetMs: 0 }

	const kept = keptPairs(
		before.map((line) => normalizeLineText(line.text)),
		after.map((line) => normalizeLineText(line.text))
	)
	if (kept === null) return { drift: 1, offsetMs: 0 }
	if (kept.length === 0) return { drift: 0, offsetMs: 0 }

	const deltas = kept.map(([i, j]) => after[j].startMs - before[i].startMs)
	const offsetMs = median(deltas)
	const threshold = config.revisions.timingLineThresholdMs
	const moved = deltas.filter((delta) => Math.abs(delta - offsetMs) > threshold).length
	return { drift: moved / kept.length, offsetMs }
}

export function measureDrift(anchor: LyricLine[], candidate: LyricLine[]): DriftResult {
	const timing = timingDrift(anchor, candidate)
	return {
		text: textDrift(anchor, candidate),
		timing: timing.drift,
		timingOffsetMs: timing.offsetMs,
	}
}
