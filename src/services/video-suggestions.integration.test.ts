import { readFileSync } from "node:fs"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import type { SongCandidate } from "@/utils/innertube"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { suggestVideosForVariant } from "./video-suggestions"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const HOME = "dQw4w9WgXcQ"
const LINKED = "9bZkp7q19f0"

const candidates: SongCandidate[] = [
	{
		videoId: LINKED,
		title: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		durationSeconds: 200,
	},
	{
		videoId: "exactmatch1",
		title: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		durationSeconds: 200,
	},
	{
		videoId: "titleonly99",
		title: "Blinding Lights",
		artist: "Someone Else",
		album: null,
		durationSeconds: 400,
	},
	{
		videoId: "nomatch0000",
		title: "Other Song",
		artist: "Nobody",
		album: null,
		durationSeconds: 200,
	},
]
const search = async () => candidates

describeIntegration("video suggestions (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let owner: number
	let lyricId: number

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = {
			DB: new D1Compat(pool),
			CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		for (const table of [
			"lyrics_video_ids",
			"contribution_events",
			"boosts",
			"badge_awards",
			"committee_members",
			"request_fulfillments",
			"lyrics_requests",
			"requested_songs",
			"votes",
			"reports",
			"lyrics",
			"users",
			"public_keys",
		]) {
			await pool.query(`DELETE FROM ${table}`)
		}
		owner = (await pool.query("INSERT INTO users (key_id) VALUES ('k') RETURNING id")).rows[0].id
		const r = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, album, duration, song_norm, artist_norm, album_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1,'Blinding Lights','The Weeknd','After Hours',200,'blinding lights','the weeknd','after hours','x','lrc','linesync',$2) RETURNING id`,
			[HOME, owner]
		)
		lyricId = r.rows[0].id
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2),($1,$3)", [
			lyricId,
			HOME,
			LINKED,
		])
	})

	it("ranks matches, flags the duration guardrail, and excludes already-linked videos", async () => {
		const res = await suggestVideosForVariant(env, lyricId, owner, { search })
		expect(res.ok).toBe(true)
		if (!res.ok) return
		const ids = res.suggestions.map((s) => s.videoId)
		expect(ids).not.toContain(HOME)
		expect(ids).not.toContain(LINKED)
		expect(ids).toEqual(["exactmatch1", "titleonly99", "nomatch0000"])
		const exact = res.suggestions[0]
		expect(exact.matchScore).toBeCloseTo(1)
		expect(exact.withinDurationDelta).toBe(true)
		expect(res.suggestions.find((s) => s.videoId === "titleonly99")?.withinDurationDelta).toBe(
			false
		)
	})

	describe("ownership", () => {
		it("rejects a non-owner", async () => {
			const other = (await pool.query("INSERT INTO users (key_id) VALUES ('k2') RETURNING id"))
				.rows[0].id
			const res = await suggestVideosForVariant(env, lyricId, other, { search })
			expect(res).toEqual({ ok: false, reason: "not_owner" })
		})

		it("rejects a missing variant", async () => {
			const res = await suggestVideosForVariant(env, 999999, owner, { search })
			expect(res).toEqual({ ok: false, reason: "not_found" })
		})
	})

	describe("cache", () => {
		const expectedIds = ["exactmatch1", "titleonly99", "nomatch0000"]

		function envWith(cache: Env["CACHE"]): Env {
			return { DB: new D1Compat(pool), CACHE: cache } as unknown as Env
		}

		it("serves a second lookup from the cache without re-searching", async () => {
			const store = new Map<string, string>()
			const puts: Array<{ ttl?: number }> = []
			const cacheEnv = envWith({
				get: async (k: string) => store.get(k) ?? null,
				put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
					store.set(k, v)
					puts.push({ ttl: opts?.expirationTtl })
				},
				delete: async () => {},
			} as unknown as Env["CACHE"])
			let calls = 0
			const countingSearch = async () => {
				calls++
				return candidates
			}

			await suggestVideosForVariant(cacheEnv, lyricId, owner, { search: countingSearch })
			const second = await suggestVideosForVariant(cacheEnv, lyricId, owner, {
				search: countingSearch,
			})

			expect(calls).toBe(1)
			expect(puts[0].ttl).toBe(config.videoLinking.suggestionCacheTtlSeconds)
			expect(second.ok).toBe(true)
			if (second.ok) expect(second.suggestions.map((s) => s.videoId)).toEqual(expectedIds)
		})

		it("regression: falls through to a fresh search on a corrupt cache entry", async () => {
			let calls = 0
			const countingSearch = async () => {
				calls++
				return candidates
			}
			const corruptEnv = envWith({
				get: async () => "{not valid json",
				put: async () => {},
				delete: async () => {},
			} as unknown as Env["CACHE"])

			const res = await suggestVideosForVariant(corruptEnv, lyricId, owner, {
				search: countingSearch,
			})

			expect(calls).toBe(1)
			expect(res.ok).toBe(true)
			if (res.ok) expect(res.suggestions.map((s) => s.videoId)).toEqual(expectedIds)
		})

		// Empty results are now negatively cached (under a shorter ttl) so a variant whose
		// song/artist yields zero hits cannot be used to hammer the external search on repeat.
		it("caches an empty search result under the negative ttl and serves repeats from it", async () => {
			const store = new Map<string, string>()
			const puts: Array<{ ttl?: number }> = []
			const cacheEnv = envWith({
				get: async (k: string) => store.get(k) ?? null,
				put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
					store.set(k, v)
					puts.push({ ttl: opts?.expirationTtl })
				},
				delete: async (k: string) => {
					store.delete(k)
				},
			} as unknown as Env["CACHE"])
			let calls = 0
			const emptySearch = async (): Promise<SongCandidate[]> => {
				calls++
				return []
			}

			const first = await suggestVideosForVariant(cacheEnv, lyricId, owner, { search: emptySearch })
			const second = await suggestVideosForVariant(cacheEnv, lyricId, owner, {
				search: emptySearch,
			})

			expect(calls).toBe(1)
			expect(store.size).toBe(1)
			expect(puts[0].ttl).toBe(config.videoLinking.emptySuggestionCacheTtlSeconds)
			expect(first.ok).toBe(true)
			if (first.ok) expect(first.suggestions).toEqual([])
			expect(second.ok).toBe(true)
			if (second.ok) expect(second.suggestions).toEqual([])
		})
	})
})
