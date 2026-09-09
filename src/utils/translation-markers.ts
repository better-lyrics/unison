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

const TRANSLATION_ROLES = new Set(["x-translation", "x-roman"])
const TRANSLATION_ELEMENTS = new Set(["translation", "translations"])

export function hasTranslationMarkers(ttml: string): boolean {
	let parsed: unknown
	try {
		parsed = parser.parse(ttml)
	} catch {
		return false
	}

	const langs = new Set<string>()
	let marked = false

	function walk(node: unknown): void {
		if (marked) return
		if (Array.isArray(node)) {
			for (const child of node) walk(child)
			return
		}
		if (typeof node !== "object" || node === null) return
		const el = node as Record<string, unknown>

		const attrs = el[":@"] as Record<string, unknown> | undefined
		if (attrs) {
			const role = attrs["@_role"]
			if (typeof role === "string" && TRANSLATION_ROLES.has(role)) {
				marked = true
				return
			}
			const lang = attrs["@_lang"]
			if (typeof lang === "string" && lang.trim()) langs.add(lang.trim())
		}

		for (const key of Object.keys(el)) {
			if (key === ":@" || key === "#text") continue
			if (TRANSLATION_ELEMENTS.has(key)) {
				marked = true
				return
			}
			walk(el[key])
		}
	}

	walk(parsed)
	return marked || langs.size >= 2
}
