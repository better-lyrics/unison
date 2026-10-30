import { config } from "@/config"
import { getCuratorLeaderboard } from "@/db/leaderboard"
import { findVariantsByVideoId } from "@/db/lyrics"
import { deboost } from "@/db/predicates"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const DAY = 86400
const { multiplier } = config.voteIntegrity

describeIntegration("repeat strike ranking multiplier (integration)", () => {
	let db: IntegrationDb
	let seq = 0
	const now = () => Math.floor(Date.now() / 1000)

	const user = (): Promise<number> => seedUser(db, `mult-${++seq}`)

	async function lyric(
		submitterId: number,
		opts: { score: number; videoId?: string; votes?: number }
	): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
				sync_type, submitter_id, effective_score, vote_count, upvotes, created_at)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3, $4, $4, $5)
			 RETURNING id`,
			[
				opts.videoId ?? `xvFZjo5PgG${(++seq % 10).toString()}`,
				submitterId,
				opts.score,
				opts.votes ?? 3,
				now() - 400 * DAY,
			]
		)
		return rows[0].id
	}

	const strike = (
		submitterId: number,
		opts: { repeat?: boolean; daysAgo?: number; undone?: boolean } = {}
	) =>
		db.pool.query(
			`INSERT INTO vote_strikes (submitter_id, kind, detected_at, key_count, vote_count, repeat, backfill, undone_at)
			 VALUES ($1, 'serial', $2, 1, 5, $3, FALSE, $4)`,
			[
				submitterId,
				now() - (opts.daysAgo ?? 1) * DAY,
				opts.repeat ?? true,
				opts.undone ? now() : null,
			]
		)

	async function deboosted(lyricsId: number): Promise<number> {
		const { rows } = await db.pool.query(
			`SELECT ${deboost("l.effective_score", "l.")} AS v FROM lyrics l WHERE l.id = $1`,
			[lyricsId]
		)
		return Number(rows[0].v)
	}

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("lowers positive and negative scores after one repeat strike", async () => {
		const submitter = await user()
		const up = await lyric(submitter, { score: 0.6 })
		const down = await lyric(submitter, { score: -0.6 })
		await strike(submitter)

		expect(await deboosted(up)).toBeCloseTo(0.6 * multiplier.one)
		expect(await deboosted(down)).toBeCloseTo(-0.6 - 0.6 * (1 - multiplier.one))
	})

	it("uses the stronger multiplier after two repeat strikes in the window", async () => {
		const submitter = await user()
		const up = await lyric(submitter, { score: 0.6 })
		await strike(submitter, { daysAgo: 20 })
		await strike(submitter, { daysAgo: 2 })

		expect(await deboosted(up)).toBeCloseTo(0.6 * multiplier.many)
	})

	it("ranks a struck submitter's variant below an equal clean one", async () => {
		const struck = await user()
		const clean = await user()
		const videoId = "aqz-KE-bpKQ"
		const struckLyric = await lyric(struck, { score: 0.9, videoId, votes: 4 })
		const cleanLyric = await lyric(clean, { score: 0.85, videoId, votes: 4 })

		expect((await findVariantsByVideoId(db.env, videoId, 10)).map((v) => v.id)).toEqual([
			struckLyric,
			cleanLyric,
		])

		await strike(struck)

		expect((await findVariantsByVideoId(db.env, videoId, 10)).map((v) => v.id)).toEqual([
			cleanLyric,
			struckLyric,
		])
	})

	it("lowers the struck submitter's leaderboard score", async () => {
		const keyId = `mult-${++seq}`
		const submitter = await seedUser(db, keyId)
		await lyric(submitter, { score: 1 })
		await lyric(submitter, { score: 1 })
		await strike(submitter)

		const row = (await getCuratorLeaderboard(db.env, 10)).find((r) => r.keyId === keyId)
		expect(row?.score).toBeCloseTo(2 * multiplier.one)
	})

	describe("edge cases", () => {
		it("a strike older than the window no longer counts", async () => {
			const submitter = await user()
			const up = await lyric(submitter, { score: 0.6 })
			await strike(submitter, { daysAgo: multiplier.windowSec / DAY + 1 })

			expect(await deboosted(up)).toBeCloseTo(0.6)
		})

		it("a zero score stays zero", async () => {
			const submitter = await user()
			const flat = await lyric(submitter, { score: 0 })
			await strike(submitter)

			expect(await deboosted(flat)).toBe(0)
		})
	})

	describe("invariants", () => {
		it("a first strike, a backfill strike or an undone repeat changes nothing", async () => {
			const first = await user()
			const undone = await user()
			const a = await lyric(first, { score: 0.6 })
			const b = await lyric(undone, { score: 0.6 })
			await strike(first, { repeat: false })
			await strike(undone, { undone: true })

			expect(await deboosted(a)).toBeCloseTo(0.6)
			expect(await deboosted(b)).toBeCloseTo(0.6)
		})

		it("never raises a score", async () => {
			const submitter = await user()
			const ids = await Promise.all(
				[-1, -0.3, 0, 0.3, 1].map((score) => lyric(submitter, { score }))
			)
			await strike(submitter)
			await strike(submitter)

			for (const [i, score] of [-1, -0.3, 0, 0.3, 1].entries()) {
				expect(await deboosted(ids[i])).toBeLessThanOrEqual(score)
			}
		})

		it("other submitters are untouched", async () => {
			const struck = await user()
			const other = await user()
			await lyric(struck, { score: 0.6 })
			const theirs = await lyric(other, { score: 0.6 })
			await strike(struck)

			expect(await deboosted(theirs)).toBeCloseTo(0.6)
		})
	})

	describe("error paths", () => {
		it("a lyric with no submitter is untouched", async () => {
			const { rows } = await db.pool.query<{ id: number }>(
				`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
					sync_type, effective_score)
				 VALUES ('jNQXAC9IVRw', 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', 0.6)
				 RETURNING id`
			)
			await strike(await user())

			expect(await deboosted(rows[0].id)).toBeCloseTo(0.6)
		})
	})
})
