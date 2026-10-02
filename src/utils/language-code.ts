import { config } from "@/config"

export const LANGUAGE_HINT = "Pick a language from the list."

const NON_LANGUAGE_CODES = new Set(["und", "mul", "zxx", "mis"])
const COVERED_BY_CURATED = new Set(["nb", "nn"])
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" })

export function isCuratedLanguage(code: string): boolean {
	return config.revisions.languages.has(code)
}

export function isLanguageCode(code: string): boolean {
	if (isCuratedLanguage(code)) return true
	if (!/^[a-z]{2,3}$/.test(code) || NON_LANGUAGE_CODES.has(code) || COVERED_BY_CURATED.has(code))
		return false
	return Intl.getCanonicalLocales(code)[0] === code && languageNames.of(code) !== undefined
}

const scriptOf = (locale: Intl.Locale): string | undefined => locale.maximize().script

export function normalizeLanguage(tag: string): string | null {
	let locale: Intl.Locale
	try {
		locale = new Intl.Locale(tag.trim().replace(/_/g, "-"))
	} catch {
		return null
	}
	if (!locale.language) return null
	const language = COVERED_BY_CURATED.has(locale.language) ? "no" : locale.language
	const script = scriptOf(locale)
	const code = script === scriptOf(new Intl.Locale(language)) ? language : `${language}-${script}`
	return isLanguageCode(code) ? code : null
}
