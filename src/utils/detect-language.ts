import { Logger } from "@/infra/logger"
import type { LyricsFormat } from "@/types"
import { extractDetectionText, ttmlParser } from "@/utils/extract-text"
import { francAll } from "franc"
import { iso6393To1 } from "iso-639-3"

const log = new Logger("detect-language")

export const DETECTOR_VERSION = 3

type EldDetector = {
	detect(text: string): { language: string; isReliable(): boolean }
	enableTextCleanup(enabled: boolean): void
}
let eldInstance: EldDetector | null = null
let eldLoadPromise: Promise<EldDetector | null> | null = null

// Indirect path defeats Vite's static-analysis pre-bundler in the test runner.
// "eld/large" is the static entry: all ngrams are imported at module-load time
// so there is no runtime `import('../ngrams/...')` inside eld.load() that
// could hang under tsx + Node ESM resolution on a Railway container.
const ELD_MODULE = "eld/large"

const ELD_LOAD_TIMEOUT_MS = 60_000

export function loadEld(): Promise<EldDetector | null> {
	if (eldInstance) return Promise.resolve(eldInstance)
	if (!eldLoadPromise) {
		const t0 = Date.now()
		log.info("eld loading")
		eldLoadPromise = Promise.race([
			(async () => {
				const mod = (await import(ELD_MODULE)) as { eld: EldDetector }
				mod.eld.enableTextCleanup(true)
				eldInstance = mod.eld
				log.info("eld loaded", { ms: Date.now() - t0 })
				return eldInstance
			})(),
			new Promise<null>((resolve) =>
				setTimeout(() => {
					if (!eldInstance) {
						log.error("eld load timed out", { ms: Date.now() - t0 })
						eldLoadPromise = null
						resolve(null)
					}
				}, ELD_LOAD_TIMEOUT_MS)
			),
		]).catch((err) => {
			log.error("eld load failed", { error: (err as Error).message, ms: Date.now() - t0 })
			eldLoadPromise = null
			return null
		})
	}
	return eldLoadPromise
}

export function isEldReady(): boolean {
	return eldInstance !== null
}

const FRANC_INDIVIDUAL_TO_639_1: Record<string, string> = {
	cmn: "zh",
	arb: "ar",
	pes: "fa",
}

// sco (Scots) and glg (Galician) are reliably misclassifications of more
// common neighbouring languages (English rap with AAVE slang; short Spanish
// with Romance overlap). Skip them and let the next ranked code win.
const FRANC_BLOCKLIST = new Set(["sco", "glg"])

export function mapTo639_1(code639_3: string): string | null {
	if (!code639_3 || code639_3 === "und") return null
	const override = FRANC_INDIVIDUAL_TO_639_1[code639_3]
	if (override) return override
	const mapped = iso6393To1[code639_3]
	return mapped ?? null
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

const DIRECT_SCRIPT_MAPPINGS: Record<string, string> = {
	Hangul: "ko",
	Hebrew: "he",
	Thai: "th",
	Tamil: "ta",
	Telugu: "te",
	Bengali: "bn",
	Gurmukhi: "pa",
	Gujarati: "gu",
	Kannada: "kn",
	Malayalam: "ml",
	Sinhala: "si",
	Myanmar: "my",
	Khmer: "km",
	Lao: "lo",
	Georgian: "ka",
	Armenian: "hy",
	Ethiopic: "am",
	Greek: "el",
}

const SCRIPT_CANDIDATES: Record<string, string[]> = {
	Cyrillic: ["rus", "ukr", "bul", "srp", "mkd", "bel", "mon", "kaz", "kir"],
	Arabic: ["arb", "pes", "urd", "pus", "snd", "uig"],
	Devanagari: ["hin", "mar", "nep", "san", "doi", "kok"],
	Han: ["cmn", "yue", "lzh", "nan", "hak"],
}

const SCRIPTS_TO_COUNT: string[] = [
	...Object.keys(DIRECT_SCRIPT_MAPPINGS),
	...Object.keys(SCRIPT_CANDIDATES),
	"Latin",
	"Hiragana",
	"Katakana",
]

const SCRIPT_REGEXES = new Map<string, RegExp>(
	SCRIPTS_TO_COUNT.map((name) => [name, new RegExp(`\\p{Script=${name}}`, "gu")])
)

const NON_LATIN_DOMINANCE_THRESHOLD = 0.2

interface ScriptHint {
	directLanguage?: string
	restrictTo?: string[]
}

export function detectByScript(text: string): ScriptHint {
	const counts: Record<string, number> = {}
	let total = 0
	for (const [name, re] of SCRIPT_REGEXES) {
		const c = (text.match(re) ?? []).length
		counts[name] = c
		total += c
	}

	if ((counts.Hiragana ?? 0) + (counts.Katakana ?? 0) > 0) {
		return { directLanguage: "ja" }
	}

	if (total === 0) return {}

	let bestScript: string | null = null
	let bestCount = 0
	for (const [name, count] of Object.entries(counts)) {
		if (name === "Latin") continue
		if (count > bestCount) {
			bestScript = name
			bestCount = count
		}
	}

	if (!bestScript || bestCount / total < NON_LATIN_DOMINANCE_THRESHOLD) return {}

	if (DIRECT_SCRIPT_MAPPINGS[bestScript]) {
		return { directLanguage: DIRECT_SCRIPT_MAPPINGS[bestScript] }
	}
	if (SCRIPT_CANDIDATES[bestScript]) {
		return { restrictTo: SCRIPT_CANDIDATES[bestScript] }
	}

	return {}
}

const MIN_LENGTH = 30
const MIN_CONFIDENCE = 0.5

export function detectLanguage(lyrics: string, format: LyricsFormat): string | null {
	if (format === "ttml") {
		const meta = extractTtmlLang(lyrics)
		if (meta) return meta
	}

	const text = extractDetectionText(lyrics, format)
	if (text.length < MIN_LENGTH) return null

	const distinctChars = new Set(text.replace(/\s+/g, "")).size
	if (distinctChars < 8) return null

	const hint = detectByScript(text)
	if (hint.directLanguage) return hint.directLanguage

	if (eldInstance) {
		const eldResult = eldInstance.detect(text)
		if (eldResult.isReliable() && eldResult.language) return eldResult.language
	}

	const opts: { minLength: number; only?: string[] } = { minLength: MIN_LENGTH }
	if (hint.restrictTo) opts.only = hint.restrictTo

	const ranked = francAll(text, opts)

	for (const [code, score] of ranked) {
		if (score < MIN_CONFIDENCE) break
		if (FRANC_BLOCKLIST.has(code)) continue
		const mapped = mapTo639_1(code)
		if (mapped) return mapped
	}

	return null
}
