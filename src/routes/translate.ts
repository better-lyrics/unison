import { config } from "@/config"
import {
	type TranslationCacheRow,
	type TranslationLine,
	computeLyricsHash,
	getTranslationCache,
	recordTranslationFailure,
	upsertTranslationCache,
} from "@/db/translation-cache"
import { readTranslationProxyEnabled } from "@/infra/env"
import { Logger } from "@/infra/logger"
import { UpstreamRateLimitedError } from "@/infra/outbound-limiter"
import type { Env } from "@/types"
import { detectLanguage } from "@/utils/detect-language"
import {
	type ParsedTranslation,
	UnparseableResponseError,
	fetchLyricsTranslation,
} from "@/utils/google-translate"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia, t } from "elysia"

const log = new Logger("translate")

const bodySchema = t.Object({
	lines: t.Array(t.String({ maxLength: config.translation.maxLineLength }), {
		maxItems: config.translation.maxLines,
	}),
	to: t.String({ maxLength: config.translation.maxLangLength }),
	from: t.Optional(t.String({ maxLength: config.translation.maxLangLength })),
	videoId: t.Optional(t.String({ maxLength: 32 })),
})

interface ResponseLine {
	translation: string | null
	romanization: string | null
	needsTranslation: boolean
}

function isBlank(line: string): boolean {
	const trimmed = line.trim()
	return trimmed === "" || trimmed === "♪"
}

function buildResponseLines(originalLines: string[], translated: ResponseLine[]): ResponseLine[] {
	const out: ResponseLine[] = []
	let next = 0
	for (const line of originalLines) {
		if (isBlank(line)) {
			out.push({ translation: null, romanization: null, needsTranslation: false })
			continue
		}
		const entry = translated[next++]
		out.push({
			translation: entry.translation,
			romanization: entry.romanization,
			needsTranslation: entry.needsTranslation,
		})
	}
	return out
}

export const translateRoutes = (env: Env) => {
	const app = new Elysia({ prefix: "/translate" }).decorate("env", env)
	if (!readTranslationProxyEnabled()) return app

	return app.use(readRateLimit).post(
		"/",
		async ({ env, body, status }) => {
			const kept = body.lines.filter((line) => !isBlank(line)).map((line) => line.trim())
			if (kept.length === 0) {
				return status(400, { success: false, error: "No translatable lines" })
			}

			const detected = await detectLanguage(kept.join("\n"))
			let from: string
			if (detected.language) {
				from = detected.language
			} else if (body.from) {
				from = body.from
			} else {
				return status(400, { success: false, error: "Could not detect source language" })
			}

			const to = body.to
			if (from === to) {
				return {
					lines: body.lines.map(() => ({
						translation: null,
						romanization: null,
						needsTranslation: false,
					})),
					detectedLang: from,
					provider: config.translation.provider,
					cached: false,
				}
			}

			const lyricsHash = computeLyricsHash(from, to, kept)

			let cached: TranslationCacheRow | null = null
			try {
				cached = await getTranslationCache(env, { lyricsHash, from, to })
			} catch (err) {
				log.warn("translation cache read failed", { error: (err as Error).message })
			}
			if (cached) {
				if (cached.isNegative) {
					return status(502, { success: false, error: "Translation upstream failed" })
				}
				if (cached.lines.length === kept.length) {
					return {
						lines: buildResponseLines(body.lines, cached.lines),
						detectedLang: from,
						provider: config.translation.provider,
						cached: true,
					}
				}
			}

			let parsed: ParsedTranslation
			try {
				parsed = await fetchLyricsTranslation(from, to, kept)
			} catch (err) {
				if (err instanceof UpstreamRateLimitedError) {
					return status(503, { success: false, error: "Translation upstream rate limited" })
				}
				if (err instanceof UnparseableResponseError) {
					try {
						await recordTranslationFailure(env, {
							lyricsHash,
							fromLang: from,
							toLang: to,
							provider: config.translation.provider,
							videoId: body.videoId ?? null,
							lineCount: kept.length,
							detectedSourceLang: from,
							httpStatus: err.httpStatus,
							rawPayload: err.rawPayload,
						})
					} catch (recordErr) {
						log.warn("translation failure record failed", {
							error: (recordErr as Error).message,
						})
					}
				}
				return status(502, { success: false, error: "Translation upstream failed" })
			}

			const rowLines: TranslationLine[] = parsed.lines.map((l, i) => ({
				i,
				original: l.original,
				translation: l.translation,
				romanization: l.romanization,
				needsTranslation: l.needsTranslation,
			}))

			try {
				await upsertTranslationCache(env, {
					lyricsHash,
					fromLang: from,
					toLang: to,
					provider: config.translation.provider,
					videoId: body.videoId ?? null,
					lineCount: kept.length,
					detectedSourceLang: from,
					hasRomanization: rowLines.some((l) => l.romanization !== null),
					isNegative: false,
					sourceLines: kept,
					lines: rowLines,
					googleVersion: parsed.googleVersion,
					googleId: parsed.googleId,
					googleToken: parsed.googleToken,
					httpStatus: parsed.httpStatus,
					rawPayload: parsed.rawPayload,
					parserVersion: config.translation.parserVersion,
					failureCount: 0,
				})
			} catch (err) {
				log.warn("translation cache upsert failed", { error: (err as Error).message })
			}

			return {
				lines: buildResponseLines(body.lines, rowLines),
				detectedLang: from,
				provider: config.translation.provider,
				cached: false,
			}
		},
		{ body: bodySchema }
	)
}
