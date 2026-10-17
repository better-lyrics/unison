import { config } from "@/config"
import {
	type TranslationCacheRow,
	getTranslationCache,
	recordTranslationFailure,
	upsertTranslationCache,
} from "@/db/translation-cache"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest"

const KEY = { lyricsHash: "hash-twinkle", from: "en", to: "zh-Hant" }
const CURRENT = config.translation.parserVersion
const OLDER = CURRENT - 1

const FAILURE = {
	lyricsHash: KEY.lyricsHash,
	fromLang: KEY.from,
	toLang: KEY.to,
	provider: config.translation.provider,
	videoId: "dQw4w9WgXcQ",
	lineCount: 12,
	detectedSourceLang: KEY.from,
	httpStatus: 200,
	rawPayload: '<div jsname="WbKHeb"></div>',
}

const POSITIVE: TranslationCacheRow = {
	lyricsHash: KEY.lyricsHash,
	fromLang: KEY.from,
	toLang: KEY.to,
	provider: config.translation.provider,
	videoId: "dQw4w9WgXcQ",
	lineCount: 1,
	detectedSourceLang: KEY.from,
	hasRomanization: false,
	isNegative: false,
	sourceLines: ["Twinkle, twinkle, little star"],
	lines: [
		{
			i: 0,
			original: "Twinkle, twinkle, little star",
			translation: "一閃一閃小星星",
			romanization: null,
			needsTranslation: true,
		},
	],
	googleVersion: null,
	googleId: null,
	googleToken: null,
	httpStatus: 200,
	rawPayload: null,
	parserVersion: CURRENT,
	failureCount: 0,
}

describeIntegration("translation_cache parser versions (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM translation_cache")
	})

	async function setParserVersion(version: number) {
		await db.pool.query("UPDATE translation_cache SET parser_version = $1", [version])
	}

	async function storedRow() {
		const { rows } = await db.pool.query(
			"SELECT failure_count, is_negative, parser_version FROM translation_cache"
		)
		return rows[0]
	}

	async function failTimes(n: number) {
		for (let i = 0; i < n; i++) await recordTranslationFailure(db.env, FAILURE)
	}

	it("suppresses a song whose failures reached the threshold under the current parser", async () => {
		await failTimes(config.translation.negativeThreshold)
		const row = await getTranslationCache(db.env, KEY)
		expect(row?.isNegative).toBe(true)
	})

	it("serves a successful translation stored by an older parser", async () => {
		await upsertTranslationCache(db.env, POSITIVE)
		await setParserVersion(OLDER)
		const row = await getTranslationCache(db.env, KEY)
		expect(row?.lines[0].translation).toBe("一閃一閃小星星")
	})

	it("ignores a suppressed song whose failures came from an older parser", async () => {
		await failTimes(config.translation.negativeThreshold)
		await setParserVersion(OLDER)
		expect(await getTranslationCache(db.env, KEY)).toBeNull()
	})

	it("ignores a below-threshold failure from an older parser", async () => {
		await failTimes(1)
		await setParserVersion(OLDER)
		expect(await getTranslationCache(db.env, KEY)).toBeNull()
	})

	it("restarts the failure count when the current parser fails a song an older parser suppressed", async () => {
		await failTimes(config.translation.negativeThreshold)
		await setParserVersion(OLDER)
		await failTimes(1)
		expect(await storedRow()).toEqual({
			failure_count: 1,
			is_negative: false,
			parser_version: CURRENT,
		})
	})

	it("suppresses again once the current parser reaches the threshold itself", async () => {
		await failTimes(config.translation.negativeThreshold)
		await setParserVersion(OLDER)
		await failTimes(config.translation.negativeThreshold)
		expect(await storedRow()).toEqual({
			failure_count: config.translation.negativeThreshold,
			is_negative: true,
			parser_version: CURRENT,
		})
	})

	it("replaces an older parser's failure with a fresh success", async () => {
		await failTimes(config.translation.negativeThreshold)
		await setParserVersion(OLDER)
		await upsertTranslationCache(db.env, POSITIVE)
		const row = await getTranslationCache(db.env, KEY)
		expect(row?.isNegative).toBe(false)
		expect(row?.failureCount).toBe(0)
		expect(row?.parserVersion).toBe(CURRENT)
	})

	it("never serves an expired row, whatever its parser version", async () => {
		await upsertTranslationCache(db.env, POSITIVE)
		await setParserVersion(OLDER)
		await db.pool.query("UPDATE translation_cache SET expires_at = now() - interval '1 second'")
		expect(await getTranslationCache(db.env, KEY)).toBeNull()
	})
})
