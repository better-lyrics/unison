import type { LyricsFormat } from "@/types"
import { extractPlainText, ttmlParser } from "@/utils/extract-text"
import { francAll } from "franc"
import { iso6393To1 } from "iso-639-3"

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
		const raw = attrs?.["@_lang"]
		if (typeof raw !== "string") return null

		const trimmed = raw.trim().toLowerCase()
		if (!trimmed) return null

		const base = trimmed.split("-")[0]
		return base || null
	}

	return null
}

const MIN_LENGTH = 30
const MIN_CONFIDENCE = 0.5

export function detectLanguage(
	lyrics: string,
	format: LyricsFormat,
	plainText?: string
): string | null {
	if (format === "ttml") {
		const meta = extractTtmlLang(lyrics)
		if (meta) return meta
	}

	const text = plainText ?? extractPlainText(lyrics, format)
	if (text.length < MIN_LENGTH) return null

	const distinctChars = new Set(text.replace(/\s+/g, "")).size
	if (distinctChars < 8) return null

	const ranked = francAll(text, { minLength: MIN_LENGTH })
	const [topCode, topScore] = ranked[0] ?? ["und", 0]
	if (topCode === "und" || topScore < MIN_CONFIDENCE) return null

	return mapTo639_1(topCode)
}
