import { config } from "@/config"
import { ErrorCode } from "@/utils/errors"
import { declareStandardPrefixes } from "@/utils/ttml-repair"
import {
	detectFormat,
	detectPrettyPrintedTtml,
	detectSyncType,
	findXmlProblem,
	hasDegenerateWordTiming,
	validateTtmlStructure,
} from "@/utils/validation"

type Format = ReturnType<typeof detectFormat>
type SyncType = ReturnType<typeof detectSyncType>

export type ContentValidation =
	| { ok: true; format: Format; syncType: SyncType; lyrics: string }
	| { ok: false; code: ErrorCode; hint?: string }

function prettyPrintHint(
	reason: "inter-span-newline" | "span-trailing-whitespace" | "span-leading-whitespace"
): string {
	switch (reason) {
		case "inter-span-newline":
			return "The TTML file has line breaks between word tags, which throws off the word-by-word timing. Try re-exporting without auto-formatting."
		case "span-trailing-whitespace":
			return "Some words in the TTML have extra spaces tacked onto the end, which throws off the highlighting. Try re-exporting from a clean source."
		case "span-leading-whitespace":
			return "Some words in the TTML start with extra spaces, which throws off the highlighting. Try re-exporting from a clean source."
	}
}

export function validateLyricContent(
	lyrics: string,
	claimedFormat: "ttml" | "lrc" | "plain"
): ContentValidation {
	if (lyrics.length > config.validation.ttml.maxSizeBytes) {
		return { ok: false, code: ErrorCode.PAYLOAD_TOO_LARGE }
	}

	if (claimedFormat === "ttml" && !validateTtmlStructure(lyrics)) {
		return { ok: false, code: ErrorCode.TTML_MALFORMED }
	}

	const format = detectFormat(lyrics)
	const content = format === "ttml" ? (declareStandardPrefixes(lyrics) ?? lyrics) : lyrics

	if (format === "ttml") {
		const xmlProblem = findXmlProblem(content)
		if (xmlProblem) {
			return {
				ok: false,
				code: ErrorCode.TTML_MALFORMED,
				hint: `The TTML file is not valid XML. ${xmlProblem.message} (line ${xmlProblem.line}, column ${xmlProblem.column}).`,
			}
		}
		const prettyCheck = detectPrettyPrintedTtml(content)
		if (!prettyCheck.ok) {
			return {
				ok: false,
				code: ErrorCode.TTML_FORMATTED,
				hint: prettyPrintHint(prettyCheck.reason),
			}
		}
		if (hasDegenerateWordTiming(content, format)) {
			return { ok: false, code: ErrorCode.TTML_ZERO_DURATION_WORDS }
		}
	}

	return { ok: true, format, syncType: detectSyncType(content, format), lyrics: content }
}
