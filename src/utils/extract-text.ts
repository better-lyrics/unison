import type { LyricsFormat } from "@/types"
import { parseLrc } from "@/utils/lrc"
import { parseTtmlTime } from "@/utils/ttml-timing"
import {
	LRC_LINE_TAG,
	LRC_WORD_TAG,
	parseTtmlTime as parseTtmlOffsetTime,
} from "@/utils/validation"
import { XMLParser } from "fast-xml-parser"

export interface LyricLine {
	text: string
	startMs: number | null
	key?: string
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	trimValues: false,
	removeNSPrefix: true,
	preserveOrder: true,
	allowBooleanAttributes: true,
	parseAttributeValue: false,
	parseTagValue: false,
})

type ParsedNode = Record<string, unknown>

const LRC_TIMING_TAGS = new RegExp(`${LRC_WORD_TAG.source}|${LRC_LINE_TAG.source}`, "g")

// Concatenate all text within a node tree, preserving whitespace between spans
function concatText(nodes: unknown[]): string {
	let result = ""
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode

		if ("#text" in el && typeof el["#text"] === "string") {
			result += el["#text"]
		}

		for (const key of Object.keys(el)) {
			if (key === "#text" || key === ":@") continue
			const child = el[key]
			if (Array.isArray(child)) {
				result += concatText(child)
			}
		}
	}
	return result
}

function beginMs(el: ParsedNode): number | null {
	const begin = (el[":@"] as ParsedNode | undefined)?.["@_begin"]
	if (typeof begin !== "string") return null
	const clock = parseTtmlTime(begin)
	const seconds = Number.isNaN(clock) ? parseTtmlOffsetTime(begin) : clock
	return seconds === null ? null : Math.round(seconds * 1000)
}

function firstTimedDescendant(nodes: unknown[]): number | null {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode
		const begin = beginMs(el)
		if (begin !== null) return begin
		for (const key of Object.keys(el)) {
			if (key === "#text" || key === ":@") continue
			const child = el[key]
			if (Array.isArray(child)) {
				const found = firstTimedDescendant(child)
				if (found !== null) return found
			}
		}
	}
	return null
}

interface ParsedTtml {
	lines: LyricLine[]
	texts: string[]
	head: LyricLine[]
}

function collectParagraphs(nodes: unknown[], out: ParsedTtml): void {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode

		if (Array.isArray(el.p)) {
			const text = concatText(el.p).trim()
			if (text) {
				out.lines.push({ text, startMs: beginMs(el) ?? firstTimedDescendant(el.p) })
				out.texts.push(text)
			}
		}

		for (const key of ["body", "div"]) {
			if (Array.isArray(el[key])) {
				collectParagraphs(el[key] as unknown[], out)
			}
		}
	}
}

// Recursively find songwriters elements anywhere in head metadata
function collectSongwriters(nodes: unknown[], out: ParsedTtml): void {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode
		if (Array.isArray(el.songwriters)) {
			for (const sw of el.songwriters as unknown[]) {
				if (typeof sw !== "object" || sw === null) continue
				const swEl = sw as ParsedNode
				if (Array.isArray(swEl.songwriter)) {
					const text = concatText(swEl.songwriter).trim()
					if (text) out.texts.push(text)
				}
			}
		}
		for (const key of Object.keys(el)) {
			if (key === "#text" || key === ":@" || key === "songwriters") continue
			const child = el[key]
			if (Array.isArray(child)) {
				collectSongwriters(child, out)
			}
		}
	}
}

const HEAD_TEXT_ELEMENT = "text"

function hasOwnText(nodes: unknown[]): boolean {
	return nodes.some((node) => {
		const text = (node as ParsedNode | null)?.["#text"]
		return typeof text === "string" && text.trim().length > 0
	})
}

// Keys a head text by the attributes that tell its siblings apart, e.g. "translation es L3".
function headTextKey(path: Array<{ name: string; attrs: ParsedNode }>): string {
	const parts: string[] = []
	for (const { name, attrs } of path) {
		const labels = [attrs["@_lang"], attrs["@_id"]].filter((v) => typeof v === "string")
		if (labels.length > 0) parts.push(name, ...(labels as string[]))
	}
	const unit = path[path.length - 1]
	const forKey = unit.attrs["@_for"]
	if (typeof forKey === "string") parts.push(forKey)
	else if (!parts.includes(unit.name)) parts.push(unit.name)
	return parts.join(" ")
}

function collectHeadText(
	nodes: unknown[],
	path: Array<{ name: string; attrs: ParsedNode }>,
	out: LyricLine[]
): void {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode
		const attrs = (el[":@"] as ParsedNode | undefined) ?? {}
		for (const name of Object.keys(el)) {
			const children = el[name]
			if (name === "#text" || name === ":@" || !Array.isArray(children)) continue
			const here = [...path, { name, attrs }]
			if (name === HEAD_TEXT_ELEMENT || hasOwnText(children)) {
				const text = concatText(children).replace(/\s+/g, " ").trim()
				if (text) out.push({ key: headTextKey(here), text, startMs: null })
			} else {
				collectHeadText(children, here, out)
			}
		}
	}
}

function parseTtml(ttml: string): ParsedTtml {
	const parsed = parser.parse(ttml) as unknown[]
	const out: ParsedTtml = { lines: [], texts: [], head: [] }

	for (const root of parsed) {
		if (typeof root !== "object" || root === null) continue
		const tt = (root as ParsedNode).tt
		if (!Array.isArray(tt)) continue

		for (const ttChild of tt) {
			if (typeof ttChild !== "object" || ttChild === null) continue
			const child = ttChild as ParsedNode

			if (Array.isArray(child.body)) {
				collectParagraphs(child.body, out)
			}

			if (Array.isArray(child.head)) {
				collectSongwriters(child.head, out)
				collectHeadText(child.head, [], out.head)
			}
		}
	}

	return out
}

export function extractPlainText(lyrics: string, format: LyricsFormat): string {
	switch (format) {
		case "plain":
			return lyrics
		case "lrc": {
			const parsed = parseLrc(lyrics)
			return parsed.map((line) => line.text).join("\n")
		}
		case "ttml":
			return parseTtml(lyrics).texts.join("\n").replace(/\s+/g, " ").trim()
	}
}

export function extractLines(lyrics: string, format: LyricsFormat): LyricLine[] {
	switch (format) {
		case "plain":
			return lyrics
				.split("\n")
				.map((line) => line.trim())
				.filter((text) => text.length > 0)
				.map((text) => ({ text, startMs: null }))
		case "lrc":
			return parseLrc(lyrics)
				.map((line) => ({
					text: line.text.replace(LRC_TIMING_TAGS, "").replace(/\s+/g, " ").trim(),
					startMs: line.timeMs,
				}))
				.filter((line) => line.text.length > 0)
		case "ttml":
			return parseTtml(lyrics).lines
	}
}

export function extractComparableLines(lyrics: string, format: LyricsFormat): LyricLine[] {
	if (format !== "ttml") return extractLines(lyrics, format)
	const parsed = parseTtml(lyrics)
	return [...parsed.lines, ...parsed.head]
}
