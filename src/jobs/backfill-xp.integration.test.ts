import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { config } from "@/config"
import { getXp } from "@/db/contribution-events"
import { D1Compat } from "@/infra/database"
import { backfillXp } from "@/jobs/backfill-xp"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const W = config.gamification.xp.weights
const MEDIUM = W.reachedMedium
const HIGH = W.reachedMedium + W.reachedHigh
const CONSENSUS = W.consensusVote
const FILLED = W.requestFilled
const FIRST = W.firstForSong

describeIntegration("backfill xp (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let keyCounter = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T
	const num = async (sql: string, params: unknown[] = []): Promise<number> =>
		Number((await pool.query(sql, params)).rows[0].n)

	async function seedUser(): Promise<number> {
		keyCounter++
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			`key-${keyCounter}`,
		])
		return row.id
	}

	async function insertLyric(
		submitterId: number | null,
		videoId: string,
		confidence: "low" | "medium" | "high" = "low",
		deleted = false
	): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, confidence, deleted_at, deleted_by_user_id, deleted_by_role)
			 VALUES ($1,'Song','Artist',180,'song','artist','gz','lrc','linesync',$2,$3,$4,$5,$6) RETURNING id`,
			[
				videoId,
				submitterId,
				confidence,
				deleted ? 1 : null,
				deleted ? submitterId : null,
				deleted ? "submitter" : null,
			]
		)
		return row.id
	}

	async function castVote(
		lyricsId: number,
		userId: number,
		vote: number,
		isSelfVote: number
	): Promise<void> {
		await pool.query(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,$3,$4)",
			[lyricsId, userId, vote, isSelfVote]
		)
	}

	async function setScore(
		lyricsId: number,
		effectiveScore: number,
		voteCount: number
	): Promise<void> {
		await pool.query("UPDATE lyrics SET effective_score = $1, vote_count = $2 WHERE id = $3", [
			effectiveScore,
			voteCount,
			lyricsId,
		])
	}

	async function insertFulfillment(
		videoId: string,
		lyricsId: number,
		submitterId: number | null
	): Promise<void> {
		await pool.query(
			"INSERT INTO request_fulfillments (video_id, lyrics_id, submitter_id, demand_snapshot, request_count_snapshot) VALUES ($1,$2,$3,1.0,1)",
			[videoId, lyricsId, submitterId]
		)
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
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	beforeEach(wipe)

	it("credits every contributor from the full corpus and converges on a second run", async () => {
		const uMed = await seedUser()
		const uHigh = await seedUser()
		const uLow = await seedUser()
		const uDeleted = await seedUser()
		const uDec = await seedUser()
		const uAgree = await seedUser()
		const uDisagree = await seedUser()
		const uFill = await seedUser()
		const uFirst = await seedUser()
		const uSecond = await seedUser()

		await insertLyric(uMed, "vidMed", "medium")
		await insertLyric(uHigh, "vidHigh", "high")
		await insertLyric(uLow, "vidLow", "low")
		await insertLyric(uDeleted, "vidDel", "high", true)
		await insertLyric(null, "vidNull", "medium")

		const lDec = await insertLyric(uDec, "vidDec", "low")
		await setScore(lDec, 1.0, 3)
		await castVote(lDec, uAgree, 1, 0)
		await castVote(lDec, uDisagree, -1, 0)
		await castVote(lDec, uDec, 1, 1)

		const lFill = await insertLyric(uFill, "vidFill", "low")
		await insertFulfillment("vidFill", lFill, uFill)
		await insertFulfillment("vidFill", lFill, null)

		await insertLyric(uFirst, "vidMulti", "low")
		await insertLyric(uSecond, "vidMulti", "low")

		const expected: Record<number, number> = {
			[uMed]: MEDIUM + FIRST,
			[uHigh]: HIGH + FIRST,
			[uLow]: FIRST,
			[uDeleted]: 0,
			[uDec]: FIRST,
			[uAgree]: CONSENSUS,
			[uDisagree]: 0,
			[uFill]: FILLED + FIRST,
			[uFirst]: FIRST,
			[uSecond]: 0,
		}

		const counts = await backfillXp(env)
		expect(counts).toEqual({ lyrics: 7, fulfillments: 1, firsts: 6 })

		for (const [userId, xp] of Object.entries(expected)) {
			expect(await getXp(env, Number(userId))).toBe(xp)
		}

		const secondCounts = await backfillXp(env)
		expect(secondCounts).toEqual({ lyrics: 7, fulfillments: 1, firsts: 6 })

		for (const [userId, xp] of Object.entries(expected)) {
			expect(await getXp(env, Number(userId))).toBe(xp)
		}
	})

	describe("edge cases", () => {
		it("returns zeros and emits nothing on an empty database", async () => {
			expect(await backfillXp(env)).toEqual({ lyrics: 0, fulfillments: 0, firsts: 0 })
			expect(await num("SELECT count(*)::int n FROM contribution_events")).toBe(0)
		})

		it("excludes a deleted lyric and a null-submitter lyric from confidence xp", async () => {
			const submitter = await seedUser()
			await insertLyric(submitter, "vidGone", "high", true)
			await insertLyric(null, "vidAnon", "high")

			const counts = await backfillXp(env)

			expect(counts.lyrics).toBe(0)
			expect(await getXp(env, submitter)).toBe(0)
			expect(await num("SELECT count(*)::int n FROM contribution_events")).toBe(0)
		})
	})

	describe("invariants", () => {
		it("first-for-song follows the live min-id predicate and ignores a deleted earlier lyric", async () => {
			const uDeletedEarly = await seedUser()
			const uSurvivor = await seedUser()
			await insertLyric(uDeletedEarly, "vidDelFirst", "low", true)
			await insertLyric(uSurvivor, "vidDelFirst", "low")

			const counts = await backfillXp(env)

			expect(counts.firsts).toBe(1)
			expect(await getXp(env, uSurvivor)).toBe(FIRST)
			expect(await getXp(env, uDeletedEarly)).toBe(0)
		})
	})
})
