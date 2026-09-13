import { readFileSync } from "node:fs"
import { RANKING_EXPR_VARIANT } from "@/db/predicates"
import { D1Compat } from "@/infra/database"
import { backfillVideoLinks } from "@/jobs/backfill-video-links"
import type { Env, LyricsRow } from "@/types"
import { compress } from "@/utils/compression"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { findByVideoId, findEligibleChallengers, findVariantsByVideoId } from "./lyrics"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const VIDEO_A = "dQw4w9WgXcQ"
const VIDEO_B = "9bZkp7q19f0"
const VIDEO_C = "kJQP7kiw5Fk"

describeIntegration("video-id lyric lookups route through the link table (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let sample: string

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		sample = await compress("never gonna give you up\nnever gonna let you down")
		env = {
			DB: new D1Compat(pool),
			CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM lyrics_video_ids")
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM badge_awards")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM contribution_events")
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function seedUser(keyId: string): Promise<number> {
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	async function insertLyric(opts: {
		videoId: string
		submitterId: number
		effectiveScore: number
		voteCount: number
		syncType?: string
	}): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, effective_score, upvotes, downvotes, vote_count)
			 VALUES ($1,'Song','Artist',180,'song','artist',$2,'lrc',$3,$4,$5,0,0,$6)
			 RETURNING id`,
			[
				opts.videoId,
				sample,
				opts.syncType ?? "linesync",
				opts.submitterId,
				opts.effectiveScore,
				opts.voteCount,
			]
		)
		return row.id
	}

	let submitter: number
	let a1: number
	let a2: number
	let a3: number
	let b1: number
	let b2: number

	beforeEach(async () => {
		await wipe()
		submitter = await seedUser("key-owner")
		a1 = await insertLyric({
			videoId: VIDEO_A,
			submitterId: submitter,
			effectiveScore: 5,
			voteCount: 10,
		})
		a2 = await insertLyric({
			videoId: VIDEO_A,
			submitterId: submitter,
			effectiveScore: 2,
			voteCount: 3,
		})
		a3 = await insertLyric({
			videoId: VIDEO_A,
			submitterId: submitter,
			effectiveScore: 1,
			voteCount: 1,
		})
		b1 = await insertLyric({
			videoId: VIDEO_B,
			submitterId: submitter,
			effectiveScore: 4,
			voteCount: 8,
		})
		b2 = await insertLyric({
			videoId: VIDEO_B,
			submitterId: submitter,
			effectiveScore: 1,
			voteCount: 2,
		})
		await backfillVideoLinks(env)
	})

	it("getPrimary returns the top-ranked variant for the video id", async () => {
		const primary = await findByVideoId(env, VIDEO_A)
		expect(primary?.id).toBe(a1)
	})

	it("findVariantsByVideoId returns every variant in ranking order", async () => {
		const rows = await findVariantsByVideoId(env, VIDEO_A, 50)
		expect(rows.map((r) => r.id)).toEqual([a1, a2, a3])
	})

	it("findEligibleChallengers returns the cold pool ordered by vote count", async () => {
		const primary = await findByVideoId(env, VIDEO_A)
		expect(primary).not.toBeNull()
		const pool_ = await findEligibleChallengers(env, VIDEO_A, primary as LyricsRow)
		expect(pool_.map((r) => r.id)).toEqual([a3, a2])
	})

	describe("regressions", () => {
		it("regression: junction with only primaries equals WHERE video_id", async () => {
			const direct = await pool.query<{ id: number }>(
				`SELECT l.id FROM lyrics l
				 WHERE l.video_id = $1 AND l.deleted_at IS NULL
				 ORDER BY ${RANKING_EXPR_VARIANT} DESC`,
				[VIDEO_A]
			)
			const directIds = direct.rows.map((r) => r.id)

			const variants = await findVariantsByVideoId(env, VIDEO_A, 50)
			expect(variants.map((r) => r.id)).toEqual(directIds)

			const primary = await findByVideoId(env, VIDEO_A)
			expect(primary?.id).toBe(directIds[0])
		})

		it("regression: a video id with no linked rows resolves to nothing", async () => {
			const primary = await findByVideoId(env, VIDEO_C)
			expect(primary).toBeNull()
			const variants = await findVariantsByVideoId(env, VIDEO_C, 50)
			expect(variants).toEqual([])
		})
	})

	describe("edge cases", () => {
		it("getPrimary resolves a row linked only through the junction to a second video id", async () => {
			await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
				a1,
				VIDEO_C,
			])

			const primary = await findByVideoId(env, VIDEO_C)
			expect(primary?.id).toBe(a1)

			const variants = await findVariantsByVideoId(env, VIDEO_C, 50)
			expect(variants.map((r) => r.id)).toEqual([a1])
		})

		it("findVariantsByVideoId includes a row linked to a second video id", async () => {
			await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
				b1,
				VIDEO_A,
			])

			const variants = await findVariantsByVideoId(env, VIDEO_A, 50)
			const ids = variants.map((r) => r.id)
			expect(ids).toContain(b1)
			expect(ids).toHaveLength(4)
			expect(ids).toEqual([a1, b1, a2, a3])
		})

		it("a single video id link never fans out to duplicate rows", async () => {
			const variants = await findVariantsByVideoId(env, VIDEO_B, 50)
			const ids = variants.map((r) => r.id)
			expect(ids).toEqual([b1, b2])
			expect(new Set(ids).size).toBe(ids.length)
		})
	})
})
