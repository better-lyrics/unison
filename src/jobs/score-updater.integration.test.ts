import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getXp } from "@/db/contribution-events"
import { D1Compat } from "@/infra/database"
import { recalculateScore } from "@/jobs/score-updater"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("score-updater xp emission (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let keyCounter = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T
	const num = async (sql: string, params: unknown[] = []): Promise<number> =>
		Number((await pool.query(sql, params)).rows[0].n)

	async function insertUser(reputation = 1.0, avgVote = 0): Promise<number> {
		keyCounter++
		const row = await one<{ id: number }>(
			"INSERT INTO users (key_id, reputation, avg_vote) VALUES ($1, $2, $3) RETURNING id",
			[`key-${keyCounter}`, reputation, avgVote]
		)
		return row.id
	}

	async function insertLyric(submitterId: number | null, videoId: string): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2) RETURNING id`,
			[videoId, submitterId]
		)
		return row.id
	}

	async function upvote(lyricsId: number, reputation: number, avgVote: number): Promise<void> {
		const voterId = await insertUser(reputation, avgVote)
		await pool.query(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,1,0)",
			[lyricsId, voterId]
		)
	}

	const countEvents = (submitterId: number, kind: string): Promise<number> =>
		num("SELECT count(*)::int n FROM contribution_events WHERE user_id = $1 AND kind = $2", [
			submitterId,
			kind,
		])

	const eventDelta = (submitterId: number, kind: string): Promise<number> =>
		num("SELECT delta::int n FROM contribution_events WHERE user_id = $1 AND kind = $2", [
			submitterId,
			kind,
		])

	const confidenceOf = async (lyricsId: number): Promise<string> =>
		(await one<{ confidence: string }>("SELECT confidence FROM lyrics WHERE id = $1", [lyricsId]))
			.confidence

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool), CACHE: { delete: async () => {} } } as unknown as Env
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

	it("awards reached-medium exactly once when a lyric reaches medium confidence", async () => {
		const submitter = await insertUser()
		const lyricId = await insertLyric(submitter, "vidMedium")
		await upvote(lyricId, 1.0, 0)
		await upvote(lyricId, 1.0, 0)
		await upvote(lyricId, 1.0, 0)

		await recalculateScore(env, lyricId)

		expect(await confidenceOf(lyricId)).toBe("medium")
		expect(await countEvents(submitter, "reached-medium")).toBe(1)
		expect(await eventDelta(submitter, "reached-medium")).toBe(20)
		expect(await countEvents(submitter, "reached-high")).toBe(0)

		await recalculateScore(env, lyricId)

		expect(await countEvents(submitter, "reached-medium")).toBe(1)
		expect(await countEvents(submitter, "reached-high")).toBe(0)
	})

	it("awards both reached-medium and reached-high when a lyric reaches high confidence", async () => {
		const submitter = await insertUser()
		const lyricId = await insertLyric(submitter, "vidHigh")
		await upvote(lyricId, 1.0, -0.5)
		await upvote(lyricId, 1.0, 0.5)
		await upvote(lyricId, 1.0, 0.5)

		await recalculateScore(env, lyricId)

		expect(await confidenceOf(lyricId)).toBe("high")
		expect(await countEvents(submitter, "reached-medium")).toBe(1)
		expect(await eventDelta(submitter, "reached-medium")).toBe(20)
		expect(await countEvents(submitter, "reached-high")).toBe(1)
		expect(await eventDelta(submitter, "reached-high")).toBe(20)

		await recalculateScore(env, lyricId)

		expect(await countEvents(submitter, "reached-medium")).toBe(1)
		expect(await countEvents(submitter, "reached-high")).toBe(1)
	})

	describe("edge cases", () => {
		it("emits no events for a submitter-less lyric that reaches medium", async () => {
			const lyricId = await insertLyric(null, "vidNoSubmitter")
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("medium")
			expect(await num("SELECT count(*)::int n FROM contribution_events")).toBe(0)
		})

		it("emits no events for a lyric that stays low confidence", async () => {
			const submitter = await insertUser()
			const lyricId = await insertLyric(submitter, "vidLow")
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("low")
			expect(await countEvents(submitter, "reached-medium")).toBe(0)
			expect(await countEvents(submitter, "reached-high")).toBe(0)
		})
	})

	describe("insert-only ratchet invariants", () => {
		it("adds reached-high on a later upgrade without re-crediting reached-medium", async () => {
			const submitter = await insertUser()
			const lyricId = await insertLyric(submitter, "vidMediumThenHigh")
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("medium")
			expect(await countEvents(submitter, "reached-medium")).toBe(1)
			expect(await countEvents(submitter, "reached-high")).toBe(0)

			await upvote(lyricId, 1.0, -0.5)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("high")
			expect(await countEvents(submitter, "reached-medium")).toBe(1)
			expect(await countEvents(submitter, "reached-high")).toBe(1)
			expect(await getXp(env, submitter)).toBe(40)
		})

		it("does not claw back reached-medium when a lyric drops back to low", async () => {
			const submitter = await insertUser()
			const lyricId = await insertLyric(submitter, "vidMediumThenLow")
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("medium")
			expect(await countEvents(submitter, "reached-medium")).toBe(1)

			await pool.query(
				"DELETE FROM votes WHERE lyrics_id = $1 AND id IN (SELECT id FROM votes WHERE lyrics_id = $1 ORDER BY id LIMIT 2)",
				[lyricId]
			)

			await recalculateScore(env, lyricId)

			expect(await confidenceOf(lyricId)).toBe("low")
			expect(await countEvents(submitter, "reached-medium")).toBe(1)
			expect(await countEvents(submitter, "reached-high")).toBe(0)
			expect(await getXp(env, submitter)).toBe(20)
		})
	})
})
