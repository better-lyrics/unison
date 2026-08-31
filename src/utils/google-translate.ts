import { config } from "@/config"
import { fetchLyricsTranslateWithRetry } from "@/infra/outbound-limiter"

export class UnparseableResponseError extends Error {
	constructor(
		message: string,
		public readonly httpStatus: number,
		public readonly rawPayload: string
	) {
		super(message)
		this.name = "UnparseableResponseError"
	}
}

export interface ParsedTranslationLine {
	original: string
	translation: string
	romanization: string | null
	needsTranslation: boolean
}

export interface ParsedTranslation {
	lines: ParsedTranslationLine[]
	httpStatus: number
	googleVersion: string | null
	googleId: string | null
	googleToken: string | null
	rawPayload: string
}

const WBKHEB_MARKER = '<div jsname="WbKHeb">'
const SPAN_SPLIT = '<span jsname="'
const TRAILER_MARKER = "c;[9,"

function unescapeHtml(input: string): string {
	return input
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&")
}

function cleanSpanText(input: string): string {
	return unescapeHtml(input.replace(/<[^>]*>/g, "")).trim()
}

export function buildLyricsTranslateUrl(from: string, to: string, lines: string[]): string {
	const enc = encodeURIComponent(lines.join("\n"))
	const asyncParam = `lyrics_partial:,lyrics_full:${enc},title:idk,lang_code_from:${encodeURIComponent(
		from
	)},lang_code_to:${encodeURIComponent(to)},exp_ui_ctx:3,_fmt:pc`
	return `https://www.google.com/async/lyrics_translate?async=${asyncParam}`
}

export function parseLyricsTranslateResponse(
	body: string,
	meta: { httpStatus: number; version: string | null; expectedLineCount: number }
): ParsedTranslation {
	if (!body || !body.trim() || !body.includes(WBKHEB_MARKER)) {
		throw new UnparseableResponseError(
			"malformed lyrics_translate response: missing WbKHeb payload",
			meta.httpStatus,
			body
		)
	}

	const stripped = body.replace(/^\)\]\}'/, "")

	const idMatch = stripped.match(/\["([^"]*)","([^"]*)"\]/)
	const googleId = idMatch ? idMatch[1] : null
	const googleToken = idMatch ? idMatch[2] : null

	const start = stripped.indexOf(WBKHEB_MARKER)
	const trailerIndex = stripped.indexOf(TRAILER_MARKER, start)
	const end = trailerIndex === -1 ? stripped.length : trailerIndex
	const rawPayload = stripped.slice(start, end)

	const lines: ParsedTranslationLine[] = []
	let current: ParsedTranslationLine | null = null

	for (const piece of rawPayload.split(SPAN_SPLIT)) {
		const quote = piece.indexOf('"')
		if (quote === -1) continue
		const jsname = piece.slice(0, quote)
		const tagEnd = piece.indexOf(">")
		if (tagEnd === -1) continue
		const text = cleanSpanText(piece.slice(tagEnd + 1))

		if (jsname === "UVGAte") {
			current = { original: "", translation: text, romanization: null, needsTranslation: false }
			lines.push(current)
		} else if (jsname === "YS01Ge") {
			if (current) current.original = text
		} else if (jsname === "tSjPGf") {
			if (current) current.romanization = text
		}
	}

	if (lines.length !== meta.expectedLineCount) {
		throw new UnparseableResponseError(
			`lyrics_translate line count mismatch: parsed ${lines.length}, expected ${meta.expectedLineCount}`,
			meta.httpStatus,
			body
		)
	}

	for (const line of lines) {
		if (!line.original.trim() || !line.translation.trim()) {
			throw new UnparseableResponseError(
				"lyrics_translate response has an empty original or translation line",
				meta.httpStatus,
				body
			)
		}
		line.needsTranslation = line.translation.trim() !== line.original.trim()
	}

	return {
		lines,
		httpStatus: meta.httpStatus,
		googleVersion: meta.version,
		googleId,
		googleToken,
		rawPayload,
	}
}

export async function fetchLyricsTranslation(
	from: string,
	to: string,
	lines: string[]
): Promise<ParsedTranslation> {
	if (lines.length === 0) {
		throw new Error("fetchLyricsTranslation requires at least one line")
	}

	const res = await fetchLyricsTranslateWithRetry(buildLyricsTranslateUrl(from, to, lines), {
		headers: { "User-Agent": config.translation.userAgent },
	})
	const body = await res.text()

	if (!res.ok || !body.trim()) {
		throw new Error(`lyrics_translate upstream failure: status ${res.status}`)
	}

	return parseLyricsTranslateResponse(body, {
		httpStatus: res.status,
		version: res.headers.get("version"),
		expectedLineCount: lines.length,
	})
}
