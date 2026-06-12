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

function extractTtmlText(ttml: string): string {
	const parsed = ttmlParser.parse(ttml) as unknown[]
	const lines: string[] = []

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

	// Collect text from <p> elements within body, each <p> becomes one line
	function collectParagraphs(nodes: unknown[]): void {
		for (const node of nodes) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode

			if (Array.isArray(el.p)) {
				const text = concatText(el.p).trim()
				if (text) lines.push(text)
			}

			// Recurse into div, body containers
			for (const key of ["body", "div"]) {
				if (Array.isArray(el[key])) {
					collectParagraphs(el[key] as unknown[])
				}
			}
		}
	}

	// Recursively find songwriters elements anywhere in head metadata
	function collectSongwriters(nodes: unknown[]): void {
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
					collectSongwriters(child)
				}
			}
		}
	}

	for (const root of parsed) {
		if (typeof root !== "object" || root === null) continue
		const rootEl = root as ParsedNode
		const tt = rootEl.tt
		if (!Array.isArray(tt)) continue

		for (const ttChild of tt) {
			if (typeof ttChild !== "object" || ttChild === null) continue
			const child = ttChild as ParsedNode

			if (Array.isArray(child.body)) {
				collectParagraphs(child.body)
			}

			if (Array.isArray(child.head)) {
				collectSongwriters(child.head)
			}
		}
	}

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
