import type { LyricsFormat } from "@/types"
import { XMLParser, XMLValidator } from "fast-xml-parser"

export type XmlProblem = { message: string; line: number; column: number }

const NON_XML_CHAR = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u
const NON_TAG_MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g
const TAG = /<([^\s/>!?][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\/[^>]+>/g
const ATTRIBUTE_NAME = /([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g
const UNDEFINED_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[^;\s<&]+;/
const TEXT_AFTER_ROOT_CODES = ["Extra text at the end", "Multiple possible root nodes found."]
const TEXT_AFTER_ROOT =
	"The file has text after the closing </tt> tag. Remove everything after </tt>"

function positionOf(text: string, index: number): { line: number; column: number } {
	const before = text.slice(0, index)
	const line = before.split("\n").length
	return { line, column: index - before.lastIndexOf("\n") }
}

function problemAt(text: string, index: number, message: string): XmlProblem {
	return { message, ...positionOf(text, index) }
}

function findElementProblem(xml: string): XmlProblem | null {
	const scopes = [new Set(["xml", "xmlns"])]
	const markup = xml.replace(NON_TAG_MARKUP, (skipped) => " ".repeat(skipped.length))
	let rootSeen = false
	for (const tag of markup.matchAll(TAG)) {
		const [, name, attributeText, selfClosing] = tag
		if (name === undefined) {
			scopes.pop()
			continue
		}
		if (scopes.length === 1 && rootSeen) return problemAt(xml, tag.index, TEXT_AFTER_ROOT)
		rootSeen = true
		const attributes = [...attributeText.matchAll(ATTRIBUTE_NAME)].map((match) => match[1])
		const declared = attributes.filter((attr) => attr.startsWith("xmlns:"))
		const parent = scopes[scopes.length - 1]
		const scope = declared.length
			? new Set([...parent, ...declared.map((attr) => attr.slice(6))])
			: parent
		for (const qualified of [name, ...attributes]) {
			const colon = qualified.indexOf(":")
			const prefix = colon > 0 ? qualified.slice(0, colon) : null
			if (prefix && !scope.has(prefix)) {
				return problemAt(
					xml,
					tag.index,
					`"${qualified}" uses the prefix "${prefix}", but the file never declares it. Add xmlns:${prefix}="..." to the <tt> tag`
				)
			}
		}
		if (!selfClosing) scopes.push(scope)
	}
	if (/<!DOCTYPE/i.test(xml)) return null
	const entity = UNDEFINED_ENTITY.exec(markup)
	return entity
		? problemAt(
				xml,
				entity.index,
				`The file uses the entity "${entity[0]}", which XML does not define. Write the character itself or a numeric reference such as &#160;`
			)
		: null
}

export function findXmlProblem(xml: string): XmlProblem | null {
	const badChar = NON_XML_CHAR.exec(xml)
	if (badChar) {
		const code = badChar[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")
		return problemAt(
			xml,
			badChar.index,
			`The file contains an invalid control character (U+${code})`
		)
	}

	const result = XMLValidator.validate(xml)
	if (result === true) return findElementProblem(xml)

	const fence = xml.indexOf("```")
	const rootStart = xml.search(/<tt[\s>]/)
	const fenceOutsideRoot = fence >= 0 && (fence < rootStart || fence > xml.lastIndexOf("</tt>"))
	if (fenceOutsideRoot) {
		return problemAt(
			xml,
			fence,
			"The file is wrapped in a ``` code fence. Remove the fence so the file starts with <tt> and ends with </tt>"
		)
	}
	const start = xml.search(/[^\s\uFEFF]/)
	if (start >= 0 && xml[start] !== "<") {
		return problemAt(
			xml,
			start,
			"The file has text before the opening <tt> tag. Remove it so the file starts with <tt>"
		)
	}
	const { msg, line, col } = result.err
	if (TEXT_AFTER_ROOT_CODES.includes(msg)) return { message: TEXT_AFTER_ROOT, line, column: col }
	return { message: msg.replace(/\.$/, ""), line, column: col }
}

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

export const LRC_WORD_TAG = /<\d{1,2}:\d{2}[.:]\d{2,3}>/
export const LRC_LINE_TAG = /\[\d{1,2}:\d{2}[.:]\d{2,3}\]/

export function detectFormat(content: string): LyricsFormat {
	if (validateTtmlStructure(content)) return "ttml"
	if (LRC_WORD_TAG.test(content) || LRC_LINE_TAG.test(content)) return "lrc"
	return "plain"
}

export type PrettyPrintCheckResult =
	| { ok: true }
	| {
			ok: false
			reason: "inter-span-newline" | "span-trailing-whitespace" | "span-leading-whitespace"
	  }

// Order matters: the inter-span newline check is the strongest signal and
// subsumes most pretty-print shapes. The trailing/leading checks are
// scoped to require an adjacent sibling span so they don't fire on
// single-span line-sync wraps.
const INTER_SPAN_NEWLINE_REGEX = /<\/span>\s*[\r\n]\s*<span\b/i
const SPAN_TRAILING_WS_REGEX = /<span\b[^>]*>[^<]*?\S[ \t]+<\/span>\s*<span\b/i
const SPAN_LEADING_WS_REGEX = /<\/span>\s*<span\b[^>]*>[ \t]+\S[^<]*<\/span>/i

export function detectPrettyPrintedTtml(content: string): PrettyPrintCheckResult {
	if (INTER_SPAN_NEWLINE_REGEX.test(content)) {
		return { ok: false, reason: "inter-span-newline" }
	}
	if (SPAN_TRAILING_WS_REGEX.test(content)) {
		return { ok: false, reason: "span-trailing-whitespace" }
	}
	if (SPAN_LEADING_WS_REGEX.test(content)) {
		return { ok: false, reason: "span-leading-whitespace" }
	}
	return { ok: true }
}

function detectLrcSyncType(lrc: string): "richsync" | "linesync" | "plain" {
	if (LRC_WORD_TAG.test(lrc)) return "richsync"
	if (LRC_LINE_TAG.test(lrc)) return "linesync"
	return "plain"
}

const ROOT_TT_TAG_REGEX = /<tt\b[^>]*>/
const DECLARED_PREFIX_REGEX = /xmlns:([A-Za-z][\w.-]*)\s*=/g
const ELEMENT_PREFIX_REGEX = /<\/?([A-Za-z][\w.-]*):/g
const ATTRIBUTE_PREFIX_REGEX = /\s([A-Za-z][\w.-]*):[\w.-]+\s*=/g

export function missingRootPrefixes(ttml: string): string[] {
	const rootTag = ttml.match(ROOT_TT_TAG_REGEX)?.[0] ?? ""
	const declared = new Set<string>(["xml", "xmlns"])
	for (const match of rootTag.matchAll(DECLARED_PREFIX_REGEX)) {
		declared.add(match[1])
	}

	const used = [...ttml.matchAll(ELEMENT_PREFIX_REGEX), ...ttml.matchAll(ATTRIBUTE_PREFIX_REGEX)]
		.sort((a, b) => a.index - b.index)
		.map((match) => match[1])
	return [...new Set(used)].filter((p) => !declared.has(p))
}

function declareMissingNamespaces(ttml: string): string {
	const rootMatch = ttml.match(ROOT_TT_TAG_REGEX)
	if (!rootMatch) return ttml

	const rootTag = rootMatch[0]
	const missing = missingRootPrefixes(ttml)
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

// A real word whose span starts and ends at the same timestamp is a
// zero-duration word: it looks like richsync but plays back with no karaoke
// sweep. Content only counts as richsync when at most this fraction of its
// real words are zero-duration. Calibrated against the full corpus: legit
// karaoke is 0% for ~80% of files and tails off through the low teens from
// aligner rounding, while degraded/abusive files sit at 40%+. 0.2 clears the
// legit tail and still catches the abuse. Whitespace and punctuation spacers
// are never counted as words, so their genuinely zero durations never trip it.
const RICHSYNC_MAX_ZERO_DURATION_RATIO = 0.2

// A span only counts as a timed "word" when it carries an actual letter or
// number. Spaces, punctuation, and other spacer glyphs can legitimately have
// zero duration and must not be scored against the word timing.
const WORD_CHAR_REGEX = /[\p{L}\p{N}]/u

// Parses a TTML time expression to seconds. Handles clock-time
// ([HH:]MM:SS[.fraction]) and offset-time (Nh/Nm/Ns/Nms). Returns null for
// forms we can't compare (frames, ticks, SMPTE), so callers give those the
// benefit of the doubt instead of misreading them as zero-duration.
export function parseTtmlTime(value: string): number | null {
	const v = value.trim()
	const clock = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/)
	if (clock) {
		const hours = clock[1] ? Number(clock[1]) : 0
		const minutes = Number(clock[2])
		const seconds = Number(clock[3])
		const fraction = clock[4] ? Number(`0.${clock[4]}`) : 0
		return hours * 3600 + minutes * 60 + seconds + fraction
	}
	const offset = v.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/)
	if (offset) {
		const n = Number(offset[1])
		switch (offset[2]) {
			case "h":
				return n * 3600
			case "m":
				return n * 60
			case "s":
				return n
			case "ms":
				return n / 1000
		}
	}
	return null
}

interface TtmlTiming {
	hasLineTiming: boolean
	sawWordSpan: boolean
	comparableWords: number
	positiveWords: number
}

function analyzeTtmlTiming(ttml: string): TtmlTiming | null {
	let parsed: unknown[]
	try {
		parsed = ttmlParser.parse(declareMissingNamespaces(ttml)) as unknown[]
	} catch {
		return null
	}

	let hasLineTiming = false
	let sawWordSpan = false
	let comparableWords = 0
	let positiveWords = 0

	function directText(children: unknown[]): string {
		let text = ""
		for (const node of children) {
			if (node && typeof node === "object" && "#text" in node) {
				const value = (node as ParsedNode)["#text"]
				if (typeof value === "string") text += value
			}
		}
		return text.trim()
	}

	function visitSpan(spanChildren: unknown[], attrs: ParsedNode | undefined): void {
		const begin = attrs?.["@_begin"]
		const end = attrs?.["@_end"]
		if (
			typeof begin === "string" &&
			typeof end === "string" &&
			WORD_CHAR_REGEX.test(directText(spanChildren))
		) {
			sawWordSpan = true
			const b = parseTtmlTime(begin)
			const e = parseTtmlTime(end)
			if (b !== null && e !== null) {
				comparableWords++
				if (e > b) positiveWords++
			}
		}
		for (const node of spanChildren) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode
			if (Array.isArray(el.span)) {
				visitSpan(el.span, el[":@"] as ParsedNode | undefined)
			}
		}
	}

	function visitParagraph(pChildren: unknown[], pAttrs: ParsedNode | undefined): void {
		if (pAttrs && (typeof pAttrs["@_begin"] === "string" || typeof pAttrs["@_end"] === "string")) {
			hasLineTiming = true
		}
		for (const node of pChildren) {
			if (typeof node !== "object" || node === null) continue
			const el = node as ParsedNode
			if (Array.isArray(el.span)) {
				visitSpan(el.span, el[":@"] as ParsedNode | undefined)
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

	return { hasLineTiming, sawWordSpan, comparableWords, positiveWords }
}

function detectTtmlSyncType(ttml: string): "richsync" | "linesync" | "plain" {
	const timing = analyzeTtmlTiming(ttml)
	if (!timing) return "plain"

	const { hasLineTiming, sawWordSpan } = timing
	if (sawWordSpan && !hasDegenerateTiming(timing)) return "richsync"
	if (hasLineTiming || sawWordSpan) return "linesync"
	return "plain"
}

// Shared verdict: real words exist that are zero-duration beyond the allowed
// ratio. comparableWords === 0 means the times were unparseable, so we give
// the file the benefit of the doubt.
function hasDegenerateTiming(timing: TtmlTiming): boolean {
	if (timing.comparableWords === 0) return false
	const zeroDurationWords = timing.comparableWords - timing.positiveWords
	return zeroDurationWords / timing.comparableWords > RICHSYNC_MAX_ZERO_DURATION_RATIO
}

// True when TTML carries real words that collapse to zero duration beyond the
// allowed ratio: it looks like richsync but delivers no karaoke sweep. Genuine
// linesync (no word spans), genuine richsync (real durations), zero-duration
// spacers/punctuation, and unparseable time formats all return false.
export function hasDegenerateWordTiming(content: string, format: LyricsFormat): boolean {
	if (format !== "ttml") return false
	const timing = analyzeTtmlTiming(content)
	if (!timing) return false
	return timing.sawWordSpan && hasDegenerateTiming(timing)
}
