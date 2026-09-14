import { readFileSync } from "node:fs"
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
})
