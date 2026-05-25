import { XMLParser } from "fast-xml-parser"
import type { LyricsFormat } from "@/types"

export function validateTtmlStructure(ttml: string): boolean {
	const hasRoot = /<tt[\s>]/i.test(ttml)
	const hasBody = /<body[\s>]/i.test(ttml) || /<body\/>/i.test(ttml)
	const hasClosingTt = /<\/tt>/i.test(ttml)

	if (!hasRoot || !hasClosingTt) {
		return false
	}

	const divCount = (ttml.match(/<div[\s>]/gi) || []).length
	const pCount = (ttml.match(/<p[\s>]/gi) || []).length

	if (divCount === 0 && pCount === 0 && !hasBody) {
		return false
	}

	return true
}

export function detectSyncType(
	content: string,
	format: LyricsFormat
): "richsync" | "linesync" | "plain" {
	switch (format) {
		case "ttml":
			return detectTtmlSyncType(content)
		case "lrc":
			return detectLrcSyncType(content)
		case "plain":
			return "plain"
	}
}

const LRC_WORD_TAG = /<\d{1,2}:\d{2}[.:]\d{2,3}>/
const LRC_LINE_TAG = /\[\d{1,2}:\d{2}[.:]\d{2,3}\]/

function detectLrcSyncType(lrc: string): "richsync" | "linesync" | "plain" {
	if (LRC_WORD_TAG.test(lrc)) return "richsync"
	if (LRC_LINE_TAG.test(lrc)) return "linesync"
	return "plain"
}

const ROOT_TT_TAG_REGEX = /<tt\b[^>]*>/
const DECLARED_PREFIX_REGEX = /xmlns:([A-Za-z][\w.-]*)\s*=/g
const ELEMENT_PREFIX_REGEX = /<\/?([A-Za-z][\w.-]*):/g
const ATTRIBUTE_PREFIX_REGEX = /\s([A-Za-z][\w.-]*):[\w.-]+\s*=/g

function declareMissingNamespaces(ttml: string): string {
	const rootMatch = ttml.match(ROOT_TT_TAG_REGEX)
	if (!rootMatch) return ttml

	const rootTag = rootMatch[0]
	const declared = new Set<string>(["xml", "xmlns"])
	for (const match of rootTag.matchAll(DECLARED_PREFIX_REGEX)) {
		declared.add(match[1])
	}

	const used = new Set<string>()
	for (const match of ttml.matchAll(ELEMENT_PREFIX_REGEX)) {
		used.add(match[1])
	}
	for (const match of ttml.matchAll(ATTRIBUTE_PREFIX_REGEX)) {
		used.add(match[1])
	}

	const missing = [...used].filter((p) => !declared.has(p))
	if (missing.length === 0) return ttml

	const additions = missing.map((p) => ` xmlns:${p}="urn:unison:unbound:${p}"`).join("")
	const patched = rootTag.replace(/\/?>$/, (end) => `${additions}${end}`)
	return ttml.replace(rootTag, patched)
}

const ttmlParser = new XMLParser({
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

function detectTtmlSyncType(ttml: string): "richsync" | "linesync" | "plain" {
	let parsed: unknown[]
	try {
		parsed = ttmlParser.parse(declareMissingNamespaces(ttml)) as unknown[]
	} catch {
		return "plain"
	}

	let hasLineTiming = false
	let hasWordTiming = false

	function spanHasWordTiming(spanChildren: unknown[], attrs: ParsedNode | undefined): boolean {
		if (attrs && typeof attrs["@_begin"] === "string" && typeof attrs["@_end"] === "string") {
			return true
		}
		for (const node of spanChildren) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode
			const childSpan = el.span
			if (Array.isArray(childSpan)) {
				if (spanHasWordTiming(childSpan, el[":@"] as ParsedNode | undefined)) {
					return true
				}
			}
		}
		return false
	}

	function visitParagraph(pChildren: unknown[], pAttrs: ParsedNode | undefined): void {
		if (pAttrs && (typeof pAttrs["@_begin"] === "string" || typeof pAttrs["@_end"] === "string")) {
			hasLineTiming = true
		}
		for (const node of pChildren) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode
			const childSpan = el.span
			if (Array.isArray(childSpan)) {
				if (spanHasWordTiming(childSpan, el[":@"] as ParsedNode | undefined)) {
					hasWordTiming = true
				}
			}
		}
	}

	function walk(nodes: unknown[]): void {
		for (const node of nodes) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode
			if (Array.isArray(el.p)) {
				visitParagraph(el.p, el[":@"] as ParsedNode | undefined)
			}
			for (const key of Object.keys(el)) {
				if (key === ":@" || key === "#text" || key === "p") continue
				const child = el[key]
				if (Array.isArray(child)) walk(child)
			}
		}
	}

	walk(parsed)

	if (hasWordTiming) return "richsync"
	if (hasLineTiming) return "linesync"
	return "plain"
}
