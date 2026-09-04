import { readFileSync } from "node:fs"
import { findVariantsByVideoId } from "@/db/lyrics"
import { PROVEN_EXPR_JOINED } from "@/db/predicates"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const CREATED_AT = 1_700_000_000

interface LyricFixture {
	effectiveScore: number
	voteCount: number
	upvotes: number
	committeeApprovedAt: number | null
}

describeIntegration("committee-approval ranking (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	async function insertSubmitter(keyId: string): Promise<number> {
		const row = await one<{ id: number }>(
			"INSERT INTO users (key_id, reputation) VALUES ($1, 1.0) RETURNING id",
			[keyId]
		)
		return row.id
	}

	async function insertLyric(
		submitterId: number,
		videoId: string,
		fixture: LyricFixture
	): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, effective_score, upvotes, downvotes, vote_count, created_at, committee_approved_at)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3, $4, 0, $5, $6, $7) RETURNING id`,
			[
				videoId,
				submitterId,
				fixture.effectiveScore,
				fixture.upvotes,
				fixture.voteCount,
				CREATED_AT,
				fixture.committeeApprovedAt,
			]
		)
		return row.id
	}

	async function proven(lyricsId: number): Promise<number> {
		const row = await one<{ proven: number | string }>(
			`SELECT (CASE WHEN ${PROVEN_EXPR_JOINED} THEN 1 ELSE 0 END) AS proven
			 FROM lyrics l JOIN users u ON u.id = l.submitter_id WHERE l.id = $1`,
			[lyricsId]
		)
		return Number(row.proven)
	}

	const APPROVED_NO_VOTES: LyricFixture = {
		effectiveScore: 0,
		voteCount: 0,
		upvotes: 0,
		committeeApprovedAt: 1000,
	}
	const UNAPPROVED_NO_VOTES: LyricFixture = {
		effectiveScore: 0,
		voteCount: 0,
		upvotes: 0,
		committeeApprovedAt: null,
	}
	const UNAPPROVED_CONSENSUS: LyricFixture = {
		effectiveScore: 1.0,
		voteCount: 30,
		upvotes: 30,
		committeeApprovedAt: null,
	}

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool) } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM badge_awards")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM contribution_events")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	beforeEach(wipe)

	it("orders variants as consensus, then committee approval, then plain unapproved", async () => {
		const submitter = await insertSubmitter("a".repeat(64))
		const videoId = "committeeRank01"
		const a = await insertLyric(submitter, videoId, APPROVED_NO_VOTES)
		const b = await insertLyric(submitter, videoId, UNAPPROVED_NO_VOTES)
		const c = await insertLyric(submitter, videoId, UNAPPROVED_CONSENSUS)

		const variants = await findVariantsByVideoId(env, videoId, 10)
		expect(variants.map((v) => v.id)).toEqual([c, a, b])
	})

	it("ranks committee approval above no approval when votes are low", async () => {
		const submitter = await insertSubmitter("a".repeat(64))
		const videoId = "committeeRank02"
		const a = await insertLyric(submitter, videoId, APPROVED_NO_VOTES)
		const b = await insertLyric(submitter, videoId, UNAPPROVED_NO_VOTES)

		const variants = await findVariantsByVideoId(env, videoId, 10)
		const order = variants.map((v) => v.id)
		expect(order.indexOf(a)).toBeLessThan(order.indexOf(b))
	})

	describe("invariants", () => {
		it("invariant: strong genuine consensus still overtakes the bounded committee bonus", async () => {
			const submitter = await insertSubmitter("a".repeat(64))
			const videoId = "committeeRank03"
			const a = await insertLyric(submitter, videoId, APPROVED_NO_VOTES)
			const c = await insertLyric(submitter, videoId, UNAPPROVED_CONSENSUS)

			const variants = await findVariantsByVideoId(env, videoId, 10)
			const order = variants.map((v) => v.id)
			expect(order.indexOf(c)).toBeLessThan(order.indexOf(a))
		})
	})

	describe("proven eligibility", () => {
		it("makes an approved zero-vote lyric primary-eligible", async () => {
			const submitter = await insertSubmitter("a".repeat(64))
			const a = await insertLyric(submitter, "committeeProven01", APPROVED_NO_VOTES)
			expect(await proven(a)).toBe(1)
		})

		it("leaves an identical unapproved zero-vote lyric ineligible", async () => {
			const submitter = await insertSubmitter("a".repeat(64))
			const b = await insertLyric(submitter, "committeeProven02", UNAPPROVED_NO_VOTES)
			expect(await proven(b)).toBe(0)
		})
	})
})
