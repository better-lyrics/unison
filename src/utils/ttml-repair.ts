import { validateLyricContent } from "@/utils/validate-lyrics"
import { findXmlProblem, missingRootPrefixes } from "@/utils/validation"

const STANDARD_NAMESPACES: Record<string, string> = {
	itunes: "http://music.apple.com/lyric-ttml-internal",
	ttm: "http://www.w3.org/ns/ttml#metadata",
	tts: "http://www.w3.org/ns/ttml#styling",
	ttp: "http://www.w3.org/ns/ttml#parameter",
	amll: "http://www.example.com/ns/amll",
	composer: "https://composer.betterlyrics.org/ttml",
}

function stripOutsideRoot(ttml: string): string | null {
	const root = ttml.search(/<tt[\s>]/)
	if (root < 0) return null
	const end = ttml.indexOf("</tt>", root)
	if (end < 0) return null
	const declaration = ttml.lastIndexOf("<?xml", root)
	return ttml.slice(declaration >= 0 ? declaration : root, end + "</tt>".length)
}

function declareStandardPrefixes(ttml: string): string | null {
	const missing = missingRootPrefixes(ttml)
	if (missing.some((prefix) => !Object.hasOwn(STANDARD_NAMESPACES, prefix))) return null
	const declarations = missing.map((prefix) => ` xmlns:${prefix}="${STANDARD_NAMESPACES[prefix]}"`)
	return ttml.replace(/<tt(?=[\s>])/, `<tt${declarations.join("")}`)
}

export function repairTtml(ttml: string): string | null {
	if (findXmlProblem(ttml) === null) return validateLyricContent(ttml, "ttml").ok ? ttml : null
	const stripped = stripOutsideRoot(ttml)
	const repaired = stripped === null ? null : declareStandardPrefixes(stripped)
	if (repaired === null || !validateLyricContent(repaired, "ttml").ok) return null
	return repaired
}
