import { XMLParser } from "fast-xml-parser"

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

type Node = Record<string, unknown>

const FILLER_RE = /^\(\s*(instrumental|interlude|intro|outro|solo)\s*\)$/i
const BRACKETED_RE = /^\(.*\)$/
const STRETCH_RE = /(\p{L})\1\1/u
const BRACKET_PAIR_RE = /\([^)]*\)/g

// Order the reviewer sees; keep firm signals before heuristics.
const SIGNAL_ORDER = [
	"line-synced",
	"filler-line",
	"stretched-spelling",
	"unbracketed-bg",
	"not-sentence-case",
	"multi-bracket-bg",
	"handoff-candidate",
] as const

function tagOf(node: Node): string | null {
	for (const key of Object.keys(node)) {
		if (key !== ":@" && key !== "#text") return key
	}
	return null
}

function attrsOf(node: Node): Record<string, string> {
	const raw = node[":@"]
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (key.startsWith("@_")) out[key.slice(2)] = String(value)
	}
	return out
}

function collectTag(nodes: unknown[], tag: string, out: Node[]): void {
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue
		const el = node as Node
		const t = tagOf(el)
		if (!t) continue
		if (t === tag) {
			out.push(el)
			continue
		}
		if (Array.isArray(el[t])) collectTag(el[t] as unknown[], tag, out)
	}
}

function concatText(nodes: unknown[]): string {
	let text = ""
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue
		const el = node as Node
		if (typeof el["#text"] === "string") text += el["#text"]
		const t = tagOf(el)
		if (t && Array.isArray(el[t])) text += concatText(el[t] as unknown[])
	}
	return text
}

// Text of a paragraph excluding its background (x-bg) spans, whitespace collapsed.
function mainText(nodes: unknown[]): string {
	let text = ""
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue
		const el = node as Node
		if (typeof el["#text"] === "string") text += el["#text"]
		const t = tagOf(el)
		if (!t || !Array.isArray(el[t])) continue
		if (t === "span" && attrsOf(el).role === "x-bg") continue
		text += mainText(el[t] as unknown[])
	}
	return text
}

function normalize(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function firstAlpha(text: string): string | null {
	const match = text.match(/\p{L}/u)
	return match ? match[0] : null
}

export function ttmlSignals(ttml: string): string[] {
	let parsed: unknown[]
	try {
		parsed = parser.parse(ttml) as unknown[]
	} catch {
		return []
	}
	if (!Array.isArray(parsed)) return []

	const paragraphs: Node[] = []
	collectTag(parsed, "p", paragraphs)
	if (paragraphs.length === 0) return []

	const found = new Set<string>()
	let anyTimedSpan = false

	for (const p of paragraphs) {
		const children = (p.p as unknown[]) ?? []
		const spans: Node[] = []
		collectTag(children, "span", spans)

		if (spans.some((s) => attrsOf(s).begin && attrsOf(s).end)) anyTimedSpan = true

		const line = normalize(mainText(children))
		if (line === "" || FILLER_RE.test(line)) found.add("filler-line")

		if (STRETCH_RE.test(normalize(concatText(children)))) found.add("stretched-spelling")

		if (line !== "" && !BRACKETED_RE.test(line)) {
			const start = firstAlpha(line)
			if (
				(start && start.toLowerCase() === start && start.toUpperCase() !== start) ||
				line.endsWith(".")
			) {
				found.add("not-sentence-case")
			}
		}

		const agents = new Set<string>()
		const pAgent = attrsOf(p).agent
		if (pAgent) agents.add(pAgent)
		for (const s of spans) {
			const a = attrsOf(s).agent
			if (a) agents.add(a)
		}
		if (agents.size > 1) found.add("handoff-candidate")

		for (const s of spans) {
			if (attrsOf(s).role !== "x-bg") continue
			const bg = normalize(concatText(s.span as unknown[]))
			if (bg === "") continue
			if (!BRACKETED_RE.test(bg)) found.add("unbracketed-bg")
			if ((bg.match(BRACKET_PAIR_RE) ?? []).length >= 2) found.add("multi-bracket-bg")
		}
	}

	if (!anyTimedSpan) found.add("line-synced")

	return SIGNAL_ORDER.filter((code) => found.has(code))
}
