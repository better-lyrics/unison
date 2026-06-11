import { iso6393To1 } from "iso-639-3"
import { ttmlParser } from "@/utils/extract-text"

const FRANC_INDIVIDUAL_TO_639_1: Record<string, string> = {
	cmn: "zh",
	arb: "ar",
	pes: "fa",
}

export function mapTo639_1(code639_3: string): string | null {
	if (!code639_3 || code639_3 === "und") return null
	const override = FRANC_INDIVIDUAL_TO_639_1[code639_3]
	if (override) return override
	const mapped = iso6393To1[code639_3]
	return mapped ?? code639_3
}

export function extractTtmlLang(ttml: string): string | null {
	let parsed: unknown
	try {
		parsed = ttmlParser.parse(ttml)
	} catch {
		return null
	}

	if (!Array.isArray(parsed)) return null

	for (const root of parsed) {
		if (typeof root !== "object" || root === null) continue
		const rootEl = root as Record<string, unknown> & { ":@"?: Record<string, string> }
		if (!("tt" in rootEl)) continue

		const attrs = rootEl[":@"]
		const raw = attrs?.["@_lang"] ?? attrs?.["@_xml:lang"]
		if (typeof raw !== "string") return null

		const trimmed = raw.trim().toLowerCase()
		if (!trimmed) return null

		const base = trimmed.split("-")[0]
		return base || null
	}

	return null
}
