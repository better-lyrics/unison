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

// lyrics_translate rejects region and script subtags with HTTP 400, except zh-Hant.
export function toLyricsTranslateLang(tag: string): string {
	if (!/[-_]/.test(tag)) return tag
	let requested: Intl.Locale
	try {
		requested = new Intl.Locale(tag.replace(/_/g, "-")).maximize()
	} catch {
		return tag
	}
	const primary = tag.split(/[-_]/)[0].toLowerCase()
	const collapsed =
		requested.language === "zh" ? (requested.script === "Hant" ? "zh-Hant" : "zh") : primary
	return new Intl.Locale(collapsed).maximize().script === requested.script ? collapsed : tag
}

export function buildLyricsTranslateUrl(from: string, to: string, lines: string[]): string {
	const enc = encodeURIComponent(lines.join("\n"))
	const asyncParam = `lyrics_partial:,lyrics_full:${enc},title:idk,lang_code_from:${encodeURIComponent(
		from
	)},lang_code_to:${encodeURIComponent(to)},exp_ui_ctx:3,_fmt:pc`
	return `https://www.google.com/async/lyrics_translate?async=${asyncParam}`
}

interface Segment {
	original: string
	translation: string
	romanization: string | null
}

function spanText(input: string): string {
	return unescapeHtml(input.replace(/<[^>]*>/g, ""))
}

// Google echoes each source line but drops or blanks control, format and U+FFFD characters.
function alignmentKey(text: string): string {
	return text.replace(/[\s\p{Cc}\p{Cf}\uFFFD]/gu, "")
}

function readSegments(rawPayload: string): Segment[] {
	const segments: Segment[] = []
	let current: Segment | null = null
	for (const piece of rawPayload.split(SPAN_SPLIT)) {
		const quote = piece.indexOf('"')
		if (quote === -1) continue
		const jsname = piece.slice(0, quote)
		const tagEnd = piece.indexOf(">")
		if (tagEnd === -1) continue
		const text = spanText(piece.slice(tagEnd + 1))

		if (jsname === "UVGAte") {
			current = { original: "", translation: text, romanization: null }
			segments.push(current)
		} else if (jsname === "YS01Ge") {
			if (current) current.original = text
		} else if (jsname === "tSjPGf") {
			if (current) current.romanization = text
		}
	}
	return segments
}

// A segment holds a block of whole lines, or one sentence of a line Google split.
function splitSegment(segment: Segment, fail: (message: string) => Error): Segment[] {
	const originals = segment.original.split("\n")
	const translations = segment.translation.split("\n")
	if (translations.length !== originals.length) {
		throw fail(
			`lyrics_translate segment has ${originals.length} original lines but ${translations.length} translation lines`
		)
	}
	const pieces: Segment[] = []
	originals.forEach((original, i) => {
		const translation = translations[i]
		const blankOriginal = original.trim() === ""
		if (blankOriginal && translation.trim() === "") return
		if (blankOriginal || translation.trim() === "") {
			throw fail("lyrics_translate response has an empty original or translation line")
		}
		pieces.push({ original, translation, romanization: null })
	})

	const romanizations = segment.romanization?.split("\n").filter((r) => r.trim() !== "")
	if (romanizations?.length === pieces.length) {
		pieces.forEach((piece, i) => {
			piece.romanization = romanizations[i]
		})
	}
	return pieces
}

export function parseLyricsTranslateResponse(
	body: string,
	meta: { httpStatus: number; version: string | null; sourceLines: readonly string[] }
): ParsedTranslation {
	const fail = (message: string) => new UnparseableResponseError(message, meta.httpStatus, body)

	if (!body || !body.trim() || !body.includes(WBKHEB_MARKER)) {
		throw fail("malformed lyrics_translate response: missing WbKHeb payload")
	}

	const stripped = body.replace(/^\)\]\}'/, "")

	const idMatch = stripped.match(/\["([^"]*)","([^"]*)"\]/)
	const googleId = idMatch ? idMatch[1] : null
	const googleToken = idMatch ? idMatch[2] : null

	const start = stripped.indexOf(WBKHEB_MARKER)
	const trailerIndex = stripped.indexOf(TRAILER_MARKER, start)
	const end = trailerIndex === -1 ? stripped.length : trailerIndex
	const rawPayload = stripped.slice(start, end)

	const pieces = readSegments(rawPayload).flatMap((segment) => splitSegment(segment, fail))
	const expected = meta.sourceLines.length
	let next = 0

	const lines = meta.sourceLines.map((source, index): ParsedTranslationLine => {
		const target = alignmentKey(source)
		const joined: Segment[] = []
		let matched = ""
		while (matched.length < target.length && next < pieces.length) {
			const piece = pieces[next++]
			joined.push(piece)
			matched += alignmentKey(piece.original)
		}
		if (matched.length < target.length) {
			throw fail(
				`lyrics_translate line count mismatch: response ends at line ${index}, expected ${expected}`
			)
		}
		if (matched !== target) {
			throw fail(`lyrics_translate original text mismatch at line ${index}`)
		}

		const original = source.trim()
		const translation = joined
			.map((p) => p.translation)
			.join("")
			.trim()
		if (!original || !translation) {
			throw fail("lyrics_translate response has an empty original or translation line")
		}
		const romanization = joined.every((p) => p.romanization !== null)
			? joined.map((p) => p.romanization?.trim()).join(" ")
			: null
		return { original, translation, romanization, needsTranslation: translation !== original }
	})

	if (next < pieces.length) {
		throw fail(
			`lyrics_translate line count mismatch: ${pieces.length - next} lines beyond the expected ${expected}`
		)
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
		sourceLines: lines,
	})
}
