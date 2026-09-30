import { setBanned } from "@/db/bans"
import { getGlobalFeed } from "@/db/feed"
import {
	findByVideoId,
	findVariantsByVideoId,
	getLyricsById,
	searchByQuery,
	submitLyrics,
} from "@/db/lyrics"
import { castVote } from "@/db/votes"
import { recalculateScore, updateScores } from "@/jobs/score-updater"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	wipeCouncilTables,
} from "@/test/integration-harness"
import type { LyricsSubmission } from "@/types"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const BANNED_KEY = "banned-key"
const OTHER_KEY = "other-key"

function submission(over: Partial<LyricsSubmission> = {}): LyricsSubmission {
	return {
		videoId: "VID00000001",
		song: "Glue",
		artist: "Bicep",
		duration: 200,
		lyrics: "first line\nsecond line\nthird line",
		format: "plain",
		syncType: "plain",
		language: "en",
		...over,
	}
}

describeIntegration("shadowban (integration)", () => {
	let db: IntegrationDb

	const seedUser = async (keyId: string): Promise<number> =>
		(await db.pool.query("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [keyId])).rows[0]
			.id as number

	const submit = async (userId: number, over: Partial<LyricsSubmission> = {}) =>
		(await submitLyrics(db.env, submission(over), userId)).id

	const setScore = (lyricsId: number, effectiveScore: number) =>
		db.pool.query("UPDATE lyrics SET effective_score = $1 WHERE id = $2", [
			effectiveScore,
			lyricsId,
		])

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		db.cache.store.clear()
		await db.pool.query("DELETE FROM request_fulfillments")
		await db.pool.query("DELETE FROM votes")
		await db.pool.query("DELETE FROM reports")
		await db.pool.query("DELETE FROM lyrics_video_ids")
		await db.pool.query("DELETE FROM contribution_events")
		await db.pool.query("DELETE FROM lyrics")
		await wipeCouncilTables(db.pool)
		await db.pool.query("DELETE FROM users")
	})

	describe("hiding", () => {
		it("stops serving a banned submitter's lyric and falls back to another variant", async () => {
			const banned = await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const bannedLyric = await submit(banned)
			const otherLyric = await submit(other)
			await setScore(bannedLyric, 1)

			expect((await findByVideoId(db.env, "VID00000001"))?.id).toBe(bannedLyric)
			await setBanned(db.env, BANNED_KEY, true)

			expect((await findByVideoId(db.env, "VID00000001"))?.id).toBe(otherLyric)
			expect((await findByVideoId(db.env, "VID00000001", BANNED_KEY))?.id).toBe(otherLyric)
		})

		it("drops a banned submitter's lyric from the variants list", async () => {
			const banned = await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			await submit(banned)
			const otherLyric = await submit(other)
			await setBanned(db.env, BANNED_KEY, true)

			const variants = await findVariantsByVideoId(db.env, "VID00000001", 10)
			expect(variants.map((v) => v.id)).toEqual([otherLyric])
		})

		it("drops a banned submitter's lyric from the global feed and search", async () => {
			const banned = await seedUser(BANNED_KEY)
			const lyric = await submit(banned)
			await setScore(lyric, 1)
			await setBanned(db.env, BANNED_KEY, true)

			expect(await getGlobalFeed(db.env, 20)).toEqual([])
			expect(await searchByQuery(db.env, "Glue Bicep", 20)).toEqual([])
		})

		it("hides lyrics the banned user submits after the ban", async () => {
			await seedUser(BANNED_KEY)
			const banned = (await db.pool.query("SELECT id FROM users WHERE key_id = $1", [BANNED_KEY]))
				.rows[0].id as number
			await setBanned(db.env, BANNED_KEY, true)
			await submit(banned, { videoId: "VID00000002" })

			expect(await findByVideoId(db.env, "VID00000002")).toBeNull()
		})

		it("evicts the cached primary so the ban takes effect at once", async () => {
			const banned = await seedUser(BANNED_KEY)
			await submit(banned)
			expect(await findByVideoId(db.env, "VID00000001")).not.toBeNull()
			expect(db.cache.store.has("v:VID00000001")).toBe(true)

			await setBanned(db.env, BANNED_KEY, true)

			expect(db.cache.store.has("v:VID00000001")).toBe(false)
			expect(await findByVideoId(db.env, "VID00000001")).toBeNull()
		})
	})

	describe("direct reads", () => {
		it("regression: a banned lyric is not readable by its id", async () => {
			const banned = await seedUser(BANNED_KEY)
			const lyric = await submit(banned)
			await setBanned(db.env, BANNED_KEY, true)

			expect(await getLyricsById(db.env, lyric)).toBeNull()
		})

		it("keeps other lyrics readable by id", async () => {
			await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const lyric = await submit(other)
			await setBanned(db.env, BANNED_KEY, true)

			expect((await getLyricsById(db.env, lyric))?.id).toBe(lyric)
		})
	})

	describe("votes", () => {
		it("regression: votes cast before the ban stop counting once banned", async () => {
			const banned = await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const lyric = await submit(other)
			await castVote(db.env, lyric, banned, 1)
			await recalculateScore(db.env, lyric)
			const before = await db.pool.query("SELECT vote_count FROM lyrics WHERE id = $1", [lyric])
			expect(before.rows[0].vote_count).toBe(1)

			await setBanned(db.env, BANNED_KEY, true)

			const after = await db.pool.query(
				"SELECT vote_count, effective_score FROM lyrics WHERE id = $1",
				[lyric]
			)
			expect(after.rows[0]).toEqual({ vote_count: 0, effective_score: 0 })
		})

		it("unban counts the old votes again", async () => {
			const banned = await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const lyric = await submit(other)
			await castVote(db.env, lyric, banned, 1)
			await setBanned(db.env, BANNED_KEY, true)
			await setBanned(db.env, BANNED_KEY, false)

			const row = await db.pool.query("SELECT vote_count FROM lyrics WHERE id = $1", [lyric])
			expect(row.rows[0].vote_count).toBe(1)
		})

		it("accepts a banned user's vote without recording it", async () => {
			const banned = await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const lyric = await submit(other)
			await setBanned(db.env, BANNED_KEY, true)

			const result = await castVote(db.env, lyric, banned, 1)

			expect(result.success).toBe(true)
			const votes = await db.pool.query("SELECT 1 FROM votes WHERE lyrics_id = $1", [lyric])
			expect(votes.rowCount).toBe(0)
			const row = await db.pool.query("SELECT vote_count FROM lyrics WHERE id = $1", [lyric])
			expect(row.rows[0].vote_count).toBe(0)
		})

		it("still records votes from users who are not banned", async () => {
			await seedUser(BANNED_KEY)
			const other = await seedUser(OTHER_KEY)
			const voter = await seedUser("voter-key")
			const lyric = await submit(other)
			await setBanned(db.env, BANNED_KEY, true)

			await castVote(db.env, lyric, voter, 1)

			const votes = await db.pool.query("SELECT 1 FROM votes WHERE lyrics_id = $1", [lyric])
			expect(votes.rowCount).toBe(1)
		})
	})

	describe("invariants", () => {
		it("never deletes, penalises or rescores anything", async () => {
			const banned = await seedUser(BANNED_KEY)
			const lyric = await submit(banned)
			await setBanned(db.env, BANNED_KEY, true)

			const row = await db.pool.query(
				"SELECT deleted_at, reputation_penalized FROM lyrics WHERE id = $1",
				[lyric]
			)
			expect(row.rows[0]).toEqual({ deleted_at: null, reputation_penalized: false })
			const user = await db.pool.query("SELECT reputation FROM users WHERE id = $1", [banned])
			expect(user.rows[0].reputation).toBe(1)
		})

		it("the score job does not treat a ban as an auto-hide penalty", async () => {
			const banned = await seedUser(BANNED_KEY)
			const lyric = await submit(banned)
			await setBanned(db.env, BANNED_KEY, true)

			await updateScores(db.env)

			const row = await db.pool.query("SELECT reputation_penalized FROM lyrics WHERE id = $1", [
				lyric,
			])
			expect(row.rows[0].reputation_penalized).toBe(false)
		})

		it("unban restores every lyric exactly as before", async () => {
			const banned = await seedUser(BANNED_KEY)
			const lyric = await submit(banned)
			await setBanned(db.env, BANNED_KEY, true)
			await setBanned(db.env, BANNED_KEY, false)

			expect((await findByVideoId(db.env, "VID00000001"))?.id).toBe(lyric)
		})

		it("keeps the first ban time when banned twice", async () => {
			await seedUser(BANNED_KEY)
			await setBanned(db.env, BANNED_KEY, true)
			const first = (
				await db.pool.query("SELECT banned_at FROM users WHERE key_id = $1", [BANNED_KEY])
			).rows[0].banned_at
			await db.pool.query("UPDATE users SET banned_at = banned_at - 100 WHERE key_id = $1", [
				BANNED_KEY,
			])
			await setBanned(db.env, BANNED_KEY, true)

			const after = (
				await db.pool.query("SELECT banned_at FROM users WHERE key_id = $1", [BANNED_KEY])
			).rows[0].banned_at
			expect(after).toBe(first - 100)
		})
	})

	describe("edge cases", () => {
		it("returns false for an unknown key", async () => {
			expect(await setBanned(db.env, "nobody", true)).toBe(false)
		})

		it("regression: lyrics with no submitter stay visible while someone is banned", async () => {
			await seedUser(BANNED_KEY)
			await setBanned(db.env, BANNED_KEY, true)
			const anon = await db.pool.query(
				`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
				 VALUES ('VID00000003', 'Song', 'Artist', 180, 'song', 'artist', 'plain text', 'plain', 'plain', NULL) RETURNING id`
			)

			expect((await findByVideoId(db.env, "VID00000003"))?.id).toBe(anon.rows[0].id)
		})
	})
})
