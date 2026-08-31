import { config } from "@/config"
import {
	type TranslationCacheRow,
	type TranslationLine,
	computeLyricsHash,
	getTranslationCache,
	upsertTranslationCache,
} from "@/db/translation-cache"
import { readTranslationProxyEnabled } from "@/infra/env"
import { Logger } from "@/infra/logger"
import { UpstreamRateLimitedError } from "@/infra/outbound-limiter"
import type { Env } from "@/types"
import { detectLanguage } from "@/utils/detect-language"
import { type ParsedTranslation, fetchLyricsTranslation } from "@/utils/google-translate"
import { readRateLimit } from "@/utils/read-rate-limit"
import { Elysia, t } from "elysia"

const log = new Logger("translate")

const bodySchema = t.Object({
	lines: t.Array(t.String()),
	to: t.String(),
	from: t.Optional(t.String()),
	videoId: t.Optional(t.String()),
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

			let from: string
			if (body.from) {
				from = body.from
			} else {
				const detected = await detectLanguage(kept.join("\n"))
				if (!detected.language) {
					return status(400, { success: false, error: "Could not detect source language" })
				}
				from = detected.language
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
			if (cached && cached.lines.length === kept.length) {
				return {
					lines: buildResponseLines(body.lines, cached.lines),
					detectedLang: from,
					provider: config.translation.provider,
					cached: true,
				}
			}

			let parsed: ParsedTranslation
			try {
				parsed = await fetchLyricsTranslation(from, to, kept)
			} catch (err) {
				if (err instanceof UpstreamRateLimitedError) {
					return status(503, { success: false, error: "Translation upstream rate limited" })
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
