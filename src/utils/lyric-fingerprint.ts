import type { LyricsFormat } from "@/types"
import { sha256Hex } from "@/utils/hash"
import { parseTtmlTime as parseBareTime } from "@/utils/ttml-timing"
import { parseTtmlTime } from "@/utils/validation"
import { XMLParser } from "fast-xml-parser"

type ParsedNode = Record<string, unknown>
type CanonicalNode = string | CanonicalElement
interface CanonicalElement {
	name: string
	attributes: [string, string][]
	children: CanonicalNode[]
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	textNodeName: "#text",
	trimValues: false,
	removeNSPrefix: true,
	preserveOrder: true,
	allowBooleanAttributes: true,
	parseAttributeValue: false,
	parseTagValue: false,
})

const TIME_ATTRIBUTES = new Set(["begin", "end", "dur"])
// Not lyrics: the root build value describes the export, and the body length and video id
// describe whichever audio the lyrics were synced to (video links are stored on their own).
const IGNORED_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
	tt: new Set(["build"]),
	body: new Set(["dur"]),
}
const VIDEO_ID_META_KEY = "ytVideoId"
const INLINE_ELEMENTS = new Set(["p", "span"])

const isWhitespace = (text: string): boolean => text.trim() === ""

function canonicalTime(value: string): string {
	const seconds = parseTtmlTime(value) ?? parseBareTime(value)
	return Number.isNaN(seconds) ? value : String(Math.round(seconds * 1000))
}

function canonicalAttributes(name: string, raw: unknown): [string, string][] {
	if (typeof raw !== "object" || raw === null) return []
	return Object.entries(raw as Record<string, string>)
		.filter(([key]) => !key.startsWith("xmlns") && !IGNORED_ATTRIBUTES[name]?.has(key))
		.map(([key, value]): [string, string] => [
			key,
			TIME_ATTRIBUTES.has(key) ? canonicalTime(value) : value,
		])
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

const isBackground = (node: CanonicalNode | undefined): boolean =>
	typeof node === "object" &&
	node.attributes.some(([key, value]) => key === "role" && value === "x-bg")

type Edge = "first" | "last"

function edgeText(
	node: CanonicalElement,
	edge: Edge
): { owner: CanonicalNode[]; index: number } | null {
	const index = edge === "first" ? 0 : node.children.length - 1
	if (index < 0 || index >= node.children.length) return null
	const child = node.children[index]
	return typeof child === "string" ? { owner: node.children, index } : edgeText(child, edge)
}

function editEdgeText(
	node: CanonicalNode,
	edge: Edge,
	edit: (text: string) => string
): CanonicalNode {
	if (typeof node === "string") return edit(node)
	const found = edgeText(node, edge)
	if (found) found.owner[found.index] = edit(found.owner[found.index] as string)
	return node
}

// Inside a line, a space between words is meaning and pretty-printing is not: every gap is
// folded into the word before it, so "<span>a </span><span>b</span>" and
// "<span>a</span>\n  <span>b</span>" read the same.
function foldInlineSpacing(nodes: CanonicalNode[], isLine: boolean): CanonicalNode[] {
	const folded: CanonicalNode[] = []
	nodes.forEach((node, index) => {
		const previous = folded.at(-1)
		if (typeof node !== "string") {
			folded.push(node)
			return
		}
		const text = node.replace(/\s+/g, " ")
		if (isWhitespace(text)) {
			if (previous === undefined) {
				if (!isLine && !node.includes("\n")) folded.push(" ")
				return
			}
			if (isBackground(previous) || isBackground(nodes[index + 1])) return
			folded[folded.length - 1] = editEdgeText(previous, "last", (last) =>
				last.endsWith(" ") ? last : `${last} `
			)
			return
		}
		const trimmed = previous === undefined && isLine ? text.trimStart() : text
		if (typeof previous === "string") folded[folded.length - 1] = previous + trimmed
		else folded.push(trimmed)
	})
	if (isLine && folded.length > 0) {
		folded[0] = editEdgeText(folded[0], "first", (text) => text.trimStart())
		folded[folded.length - 1] = editEdgeText(folded[folded.length - 1], "last", (text) =>
			text.trimEnd()
		)
	}
	return folded
}

function canonicalChildren(nodes: unknown[], parentName: string): CanonicalNode[] {
	const children: CanonicalNode[] = []
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue
		const parsed = node as ParsedNode
		if (typeof parsed["#text"] === "string") {
			children.push(parsed["#text"])
			continue
		}
		const name = Object.keys(parsed).find((key) => key !== ":@" && !key.startsWith("?"))
		if (!name) continue
		const attributes = canonicalAttributes(name, parsed[":@"])
		const isVideoId =
			name === "meta" &&
			attributes.some(([key, value]) => key === "key" && value === VIDEO_ID_META_KEY)
		if (isVideoId) continue
		children.push({
			name,
			attributes,
			children: canonicalChildren(parsed[name] as unknown[], name),
		})
	}
	if (INLINE_ELEMENTS.has(parentName)) return foldInlineSpacing(children, parentName === "p")
	return children.flatMap((child): CanonicalNode[] => {
		if (typeof child !== "string") return [child]
		const text = child.replace(/\s+/g, " ").trim()
		return text ? [text] : []
	})
}

function canonicalLrc(content: string): string {
	return content
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.join("\n")
		.trim()
}

/**
 * Hash of what a lyric says and when, without how its file is laid out: two contents with the
 * same fingerprint show the same lyrics in every player.
 */
export function lyricFingerprint(content: string, format: LyricsFormat): string {
	const canonical =
		format === "ttml"
			? JSON.stringify(canonicalChildren(parser.parse(content) as unknown[], ""))
			: canonicalLrc(content)
	return sha256Hex(`${format}\n${canonical}`)
}
