import { createHash } from "node:crypto"
import { config } from "@/config"
import { Logger } from "@/infra/logger"
import type { Env } from "@/types"

const log = new Logger("translation-cache")

export interface TranslationLine {
	i: number
	original: string
	translation: string | null
	romanization: string | null
	needsTranslation: boolean
}

export interface TranslationCacheRow {
	lyricsHash: string
	fromLang: string
	toLang: string
	provider: string
	videoId: string | null
	lineCount: number
	detectedSourceLang: string | null
	hasRomanization: boolean
	isNegative: boolean
	sourceLines: string[]
	lines: TranslationLine[]
	googleVersion: string | null
	googleId: string | null
	googleToken: string | null
	httpStatus: number | null
	rawPayload: string | null
	parserVersion: number
}

interface TranslationCacheDbRow {
	lyrics_hash: string
	from_lang: string
	to_lang: string
	provider: string
	video_id: string | null
	line_count: number
	detected_source_lang: string | null
	has_romanization: boolean
	is_negative: boolean
	source_lines: unknown
	lines: unknown
	google_version: string | null
	google_id: string | null
	google_token: string | null
	http_status: number | null
	raw_payload: string | null
	parser_version: number
}

export function computeLyricsHash(from: string, to: string, lines: string[]): string {
	const normalized = lines.map((line) => line.trim()).join("\n")
	return createHash("sha256").update(`${from} ${to} ${normalized}`).digest("hex")
}

function parseJsonb<T>(value: unknown): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : (value as T)
}

function mapRow(row: TranslationCacheDbRow): TranslationCacheRow {
	return {
		lyricsHash: row.lyrics_hash,
		fromLang: row.from_lang,
		toLang: row.to_lang,
		provider: row.provider,
		videoId: row.video_id,
		lineCount: row.line_count,
		detectedSourceLang: row.detected_source_lang,
		hasRomanization: row.has_romanization,
		isNegative: row.is_negative,
		sourceLines: parseJsonb<string[]>(row.source_lines),
		lines: parseJsonb<TranslationLine[]>(row.lines),
		googleVersion: row.google_version,
		googleId: row.google_id,
		googleToken: row.google_token,
		httpStatus: row.http_status,
		rawPayload: row.raw_payload,
		parserVersion: row.parser_version,
	}
}

export async function getTranslationCache(
	env: Env,
	key: { lyricsHash: string; from: string; to: string; provider?: string }
): Promise<TranslationCacheRow | null> {
	const provider = key.provider ?? config.translation.provider
	const row = await env.DB.prepare(
		`SELECT lyrics_hash, from_lang, to_lang, provider, video_id, line_count,
			detected_source_lang, has_romanization, is_negative, source_lines, lines,
			google_version, google_id, google_token, http_status, raw_payload, parser_version
		 FROM translation_cache
		 WHERE lyrics_hash = ? AND from_lang = ? AND to_lang = ? AND provider = ?
		   AND expires_at > now()`
	)
		.bind(key.lyricsHash, key.from, key.to, provider)
		.first<TranslationCacheDbRow>()

	if (!row) {
		log.debug("cache miss", { lyricsHash: key.lyricsHash, from: key.from, to: key.to })
		return null
	}

	log.debug("cache hit", { lyricsHash: key.lyricsHash, from: key.from, to: key.to })
	return mapRow(row)
}

export async function upsertTranslationCache(env: Env, row: TranslationCacheRow): Promise<void> {
	const ttlSeconds = row.isNegative
		? config.translation.negativeTtlSeconds
		: config.translation.positiveTtlSeconds

	await env.DB.prepare(
		`INSERT INTO translation_cache (
			lyrics_hash, from_lang, to_lang, provider, video_id, line_count,
			detected_source_lang, has_romanization, is_negative, source_lines, lines,
			google_version, google_id, google_token, http_status, raw_payload, parser_version,
			expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now() + (? || ' seconds')::interval)
		ON CONFLICT (lyrics_hash, from_lang, to_lang, provider) DO UPDATE SET
			video_id = EXCLUDED.video_id,
			line_count = EXCLUDED.line_count,
			detected_source_lang = EXCLUDED.detected_source_lang,
			has_romanization = EXCLUDED.has_romanization,
			is_negative = EXCLUDED.is_negative,
			source_lines = EXCLUDED.source_lines,
			lines = EXCLUDED.lines,
			google_version = EXCLUDED.google_version,
			google_id = EXCLUDED.google_id,
			google_token = EXCLUDED.google_token,
			http_status = EXCLUDED.http_status,
			raw_payload = EXCLUDED.raw_payload,
			parser_version = EXCLUDED.parser_version,
			expires_at = EXCLUDED.expires_at,
			updated_at = now()`
	)
		.bind(
			row.lyricsHash,
			row.fromLang,
			row.toLang,
			row.provider,
			row.videoId,
			row.lineCount,
			row.detectedSourceLang,
			row.hasRomanization,
			row.isNegative,
			JSON.stringify(row.sourceLines),
			JSON.stringify(row.lines),
			row.googleVersion,
			row.googleId,
			row.googleToken,
			row.httpStatus,
			row.rawPayload,
			row.parserVersion,
			ttlSeconds
		)
		.run()

	log.debug("cache upsert", {
		lyricsHash: row.lyricsHash,
		from: row.fromLang,
		to: row.toLang,
		negative: row.isNegative,
	})
}
