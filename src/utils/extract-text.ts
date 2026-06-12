import { XMLParser } from "fast-xml-parser"
import type { LyricsFormat } from "@/types"
import { parseLrc } from "@/utils/lrc"

export const ttmlParser = new XMLParser({
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

function collectParagraphLines(nodes: unknown[], lines: string[]): void {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode

		if (Array.isArray(el.p)) {
			const text = concatText(el.p).trim()
			if (text) lines.push(text)
		}

		for (const key of ["body", "div"]) {
			if (Array.isArray(el[key])) {
				collectParagraphLines(el[key] as unknown[], lines)
			}
		}
	}
}

function collectSongwriterLines(nodes: unknown[], lines: string[]): void {
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const el = node as ParsedNode
		if (Array.isArray(el.songwriters)) {
			for (const sw of el.songwriters as unknown[]) {
				if (typeof sw !== "object" || sw === null) continue
				const swEl = sw as ParsedNode
				if (Array.isArray(swEl.songwriter)) {
					const text = concatText(swEl.songwriter).trim()
					if (text) lines.push(text)
				}
			}
		}
		for (const key of Object.keys(el)) {
			if (key === "#text" || key === ":@" || key === "songwriters") continue
			const child = el[key]
			if (Array.isArray(child)) {
				collectSongwriterLines(child, lines)
			}
		}
	}
}

function parseTtml(ttml: string): unknown[] {
	const parsed = ttmlParser.parse(ttml) as unknown[]
	return Array.isArray(parsed) ? parsed : []
}

function forEachTtChild(parsed: unknown[], fn: (child: ParsedNode) => void): void {
	for (const root of parsed) {
		if (typeof root !== "object" || root === null) continue
		const tt = (root as ParsedNode).tt
		if (!Array.isArray(tt)) continue
		for (const ttChild of tt) {
			if (typeof ttChild !== "object" || ttChild === null) continue
			fn(ttChild as ParsedNode)
		}
	}
}

function extractTtmlText(ttml: string): string {
	const parsed = parseTtml(ttml)
	const lines: string[] = []

	forEachTtChild(parsed, (child) => {
		if (Array.isArray(child.body)) collectParagraphLines(child.body, lines)
		if (Array.isArray(child.head)) collectSongwriterLines(child.head, lines)
	})

	return lines.join("\n").replace(/\s+/g, " ").trim()
}

export function extractTtmlBody(ttml: string): string {
	const parsed = parseTtml(ttml)
	const lines: string[] = []

	forEachTtChild(parsed, (child) => {
		if (Array.isArray(child.body)) collectParagraphLines(child.body, lines)
	})

	return lines.join("\n").replace(/\s+/g, " ").trim()
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
			return extractTtmlText(lyrics)
	}
}

export function extractDetectionText(lyrics: string, format: LyricsFormat): string {
	if (format === "ttml") return extractTtmlBody(lyrics)
	return extractPlainText(lyrics, format)
}
