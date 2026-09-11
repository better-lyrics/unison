// Shifts operate on the raw begin/end strings so TTML structure survives; dur is left alone.

export function parseTtmlTime(value: string): number {
	const parts = value.trim().split(":")
	const nums = parts.map(Number)
	if (nums.some(Number.isNaN)) return Number.NaN
	if (nums.length === 1) return nums[0]
	if (nums.length === 2) return nums[0] * 60 + nums[1]
	if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
	return Number.NaN
}

export function formatTtmlTime(seconds: number): string {
	const totalMs = Math.round(Math.max(0, seconds) * 1000)
	const whole = Math.floor(totalMs / 1000)
	const frac = (totalMs % 1000).toString().padStart(3, "0")
	const h = Math.floor(whole / 3600)
	const m = Math.floor((whole % 3600) / 60)
	const s = whole % 60
	const pad = (n: number) => n.toString().padStart(2, "0")
	if (h > 0) return `${h}:${pad(m)}:${pad(s)}.${frac}`
	if (m > 0) return `${m}:${pad(s)}.${frac}`
	return `${s}.${frac}`
}

const TIME_ATTR_RE = /\b(begin|end)="([^"]+)"/g

// Shift every begin/end by a constant to align a sync or make it uniformly late/early.
export function shiftTtml(ttml: string, deltaSeconds: number): string {
	if (deltaSeconds === 0) return ttml
	return ttml.replace(TIME_ATTR_RE, (_full, attr: string, value: string) => {
		const t = parseTtmlTime(value)
		return Number.isNaN(t) ? `${attr}="${value}"` : `${attr}="${formatTtmlTime(t + deltaSeconds)}"`
	})
}

// Offset ramps from 0 at the window start to maxDelta by the end; times before the window are left.
export function driftTtml(
	ttml: string,
	startSec: number,
	endSec: number,
	maxDelta: number
): string {
	const span = endSec - startSec
	if (span <= 0) return ttml
	return ttml.replace(TIME_ATTR_RE, (_full, attr: string, value: string) => {
		const t = parseTtmlTime(value)
		if (Number.isNaN(t) || t <= startSec) return `${attr}="${value}"`
		const frac = Math.min(1, (t - startSec) / span)
		return `${attr}="${formatTtmlTime(t + maxDelta * frac)}"`
	})
}

const TEXT_NODE_RE = />([^<]+)</g

// Lowercase text nodes only (tags and times untouched) for a bad-casing A/B rendering.
export function lowercaseTtmlText(ttml: string): string {
	return ttml.replace(TEXT_NODE_RE, (_full, text: string) => `>${text.toLowerCase()}<`)
}

const DIV_BLOCK_RE = /<div\b[^>]*>[\s\S]*?<\/div>/g
const P_BLOCK_RE = /<p\b[^>]*>[\s\S]*?<\/p>/g

// Drop <p> outside [start, end] and empty <div>; a line overlapping the window is kept whole.
export function trimTtmlToWindow(ttml: string, startSec: number, endSec: number): string {
	return ttml.replace(DIV_BLOCK_RE, (divBlock) => {
		const open = /^<div\b[^>]*>/.exec(divBlock)?.[0]
		if (!open) return divBlock
		const kept: string[] = []
		for (const m of divBlock.matchAll(P_BLOCK_RE)) {
			const pBlock = m[0]
			const begin = /\bbegin="([^"]+)"/.exec(pBlock)?.[1]
			const end = /\bend="([^"]+)"/.exec(pBlock)?.[1]
			if (begin === undefined || end === undefined) continue
			const b = parseTtmlTime(begin)
			const e = parseTtmlTime(end)
			if (Number.isNaN(b) || Number.isNaN(e)) continue
			if (e > startSec && b < endSec) kept.push(pBlock)
		}
		return kept.length === 0 ? "" : `${open}${kept.join("")}</div>`
	})
}

export interface TtmlSection {
	part: string | null
	start: number
	end: number
}

const DIV_OPEN_RE = /<div\b([^>]*)>/g

export function listSections(ttml: string): TtmlSection[] {
	const out: TtmlSection[] = []
	for (const m of ttml.matchAll(DIV_OPEN_RE)) {
		const attrs = m[1]
		const begin = /\bbegin="([^"]+)"/.exec(attrs)?.[1]
		const end = /\bend="([^"]+)"/.exec(attrs)?.[1]
		if (!begin || !end) continue
		const start = parseTtmlTime(begin)
		const stop = parseTtmlTime(end)
		if (Number.isNaN(start) || Number.isNaN(stop)) continue
		const part = /songPart="([^"]+)"/.exec(attrs)?.[1] ?? null
		out.push({ part, start, end: stop })
	}
	return out
}

// Prefer the first named song part, else the first non-intro section, capped to maxSec.
export function pickSectionWindow(
	ttml: string,
	opts?: { prefer?: string[]; maxSec?: number }
): { start: number; end: number } | null {
	const sections = listSections(ttml)
	if (sections.length === 0) return null
	const prefer = opts?.prefer ?? ["Chorus", "Refrain", "Verse"]
	const maxSec = opts?.maxSec ?? 18

	let chosen: TtmlSection | undefined
	for (const p of prefer) {
		chosen = sections.find((s) => s.part?.toLowerCase() === p.toLowerCase())
		if (chosen) break
	}
	if (!chosen) {
		chosen = sections.find((s) => (s.part ?? "").toLowerCase() !== "intro") ?? sections[0]
	}
	return { start: chosen.start, end: Math.min(chosen.end, chosen.start + maxSec) }
}
