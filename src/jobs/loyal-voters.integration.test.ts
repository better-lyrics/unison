import { config } from "@/config"
import { getCuratorLeaderboard, CURATOR_LEADERBOARD_CACHE_KEY } from "@/db/leaderboard"
import { LOYAL_ONLY_EXPR_JOINED, RANKING_EXPR } from "@/db/predicates"
import { backfillConfidence } from "@/jobs/backfill-confidence"
import { recalculateScore } from "@/jobs/score-updater"
import { runVoteIntegrity } from "@/jobs/vote-integrity"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const HOUR = 3600
const DAY = 86400

const { launchedAt, loyalMinVotes } = config.voteIntegrity
const { weights } = config.gamification.xp
const NOW = launchedAt + 10 * DAY
const LONG_AGO = NOW - 200 * DAY

let db: IntegrationDb
let seq = 0
let clock = NOW - 100 * DAY

async function seedKey(): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		"INSERT INTO users (key_id, created_at) VALUES ($1, $2) RETURNING id",
		[`lv-${++seq}`, LONG_AGO]
	)
	return rows[0].id
}

async function lyric(submitterId: number | null, videoId?: string): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
			sync_type, submitter_id, created_at)
		 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3)
		 RETURNING id`,
		[videoId ?? `kJQP7kiw${String(++seq).padStart(3, "0")}`, submitterId, LONG_AGO]
	)
	return rows[0].id
}

async function lyrics(submitterId: number, n: number): Promise<number[]> {
	const ids: number[] = []
	for (let i = 0; i < n; i++) ids.push(await lyric(submitterId))
	return ids
}

const vote = (userId: number, lyricsId: number, value = 1, self = 0) => {
	clock += 2 * HOUR
	return db.pool.query(
		`INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		[lyricsId, userId, value, self, clock]
	)
}

async function voteAll(userId: number, ids: number[]): Promise<void> {
	for (const id of ids) await vote(userId, id)
}

async function loyalKeys(targets: number[], n: number): Promise<number[]> {
	const keys: number[] = []
	for (let i = 0; i < n; i++) {
		const key = await seedKey()
		await voteAll(key, targets)
		keys.push(key)
	}
	return keys
}

interface Row {
	loyal_only: boolean
	confidence: string
	effective_score: number
	vote_count: number
}

async function row(id: number): Promise<Row> {
	const { rows } = await db.pool.query<Row>(
		"SELECT loyal_only, confidence, effective_score, vote_count FROM lyrics WHERE id = $1",
		[id]
	)
	return rows[0]
}

async function loyalOnly(id: number): Promise<boolean> {
	const { rows } = await db.pool.query<{ loyal: boolean }>(
		`SELECT ${LOYAL_ONLY_EXPR_JOINED} AS loyal FROM lyrics l WHERE l.id = $1`,
		[id]
	)
	return rows[0].loyal
}

async function xpEvents(userId: number) {
	const { rows } = await db.pool.query<{ kind: string; ref_id: number }>(
		"SELECT kind, ref_id FROM contribution_events WHERE user_id = $1 ORDER BY kind, ref_id",
		[userId]
	)
	return rows
}

async function boardScore(userId: number): Promise<number | undefined> {
	const { rows } = await db.pool.query<{ key_id: string }>(
		"SELECT key_id FROM users WHERE id = $1",
		[userId]
	)
	db.cache.store.clear()
	const board = await getCuratorLeaderboard(db.env, 100)
	return board.find((r) => r.keyId === rows[0].key_id)?.score
}

const recalc = async (ids: number[]) => {
	for (const id of ids) await recalculateScore(db.env, id)
}

async function failLyricUpdates(lyricsId: number): Promise<() => Promise<void>> {
	await db.pool.query(
		`CREATE OR REPLACE FUNCTION lv_fail() RETURNS trigger AS $$
		BEGIN
			IF NEW.id = ${lyricsId} THEN RAISE EXCEPTION 'blocked'; END IF;
			RETURN NEW;
		END $$ LANGUAGE plpgsql`
	)
	await db.pool.query(
		"CREATE TRIGGER lv_fail BEFORE UPDATE ON lyrics FOR EACH ROW EXECUTE FUNCTION lv_fail()"
	)
	return async () => {
		await db.pool.query("DROP TRIGGER IF EXISTS lv_fail ON lyrics")
		await db.pool.query("DROP FUNCTION IF EXISTS lv_fail()")
	}
}

interface Propped {
	submitter: number
	targets: number[]
	keys: number[]
}

async function propped(keyCount = 3): Promise<Propped> {
	const submitter = await seedKey()
	const targets = await lyrics(submitter, loyalMinVotes)
	const keys = await loyalKeys(targets, keyCount)
	return { submitter, targets, keys }
}

describeIntegration("loyal-only lyrics", () => {
	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		await db.pool.query("DELETE FROM contribution_events")
		db.cache.store.clear()
	})

	it("a lyric propped only by loyal keys stays low", async () => {
		const p = await propped()
		await recalc(p.targets)

		expect(await row(p.targets[0])).toMatchObject({ loyal_only: true, confidence: "low" })
		expect(await xpEvents(p.submitter)).toEqual([])
	})

	it("loyal upvotes still move effective_score, vote_count and the variant ranking", async () => {
		const p = await propped()
		const videoId = "LoyalRank01"
		await db.pool.query("UPDATE lyrics SET video_id = $1 WHERE id = $2", [videoId, p.targets[0]])
		const rival = await lyric(await seedKey(), videoId)
		await recalc([...p.targets, rival])

		expect(await row(p.targets[0])).toMatchObject({ effective_score: 1, vote_count: 3 })
		const { rows } = await db.pool.query<{ id: number }>(
			`SELECT id FROM lyrics WHERE video_id = $1 ORDER BY ${RANKING_EXPR} DESC`,
			[videoId]
		)
		expect(rows[0].id).toBe(p.targets[0])
	})

	it("one independent upvote restores medium confidence and its XP", async () => {
		const p = await propped()
		await vote(await seedKey(), p.targets[0])
		await recalc(p.targets)

		expect(await row(p.targets[0])).toMatchObject({ loyal_only: false, confidence: "medium" })
		expect(await row(p.targets[1])).toMatchObject({ loyal_only: true, confidence: "low" })
		expect((await xpEvents(p.submitter)).map((e) => e.ref_id)).toContain(p.targets[0])
	})

	it("a key loyal to one submitter counts as independent on another", async () => {
		const a = await propped(1)
		const b = await propped(2)
		await vote(a.keys[0], b.targets[0])
		await recalc(b.targets)

		expect(await row(b.targets[0])).toMatchObject({ loyal_only: false, confidence: "medium" })
	})

	describe("leaderboard", () => {
		it("a loyal-only lyric gives no leaderboard credit", async () => {
			const p = await propped()
			await recalc(p.targets)

			expect(await boardScore(p.submitter)).toBe(0)
		})

		it("one independent upvote restores the credit", async () => {
			const p = await propped()
			await vote(await seedKey(), p.targets[0])
			await recalc(p.targets)

			expect(await boardScore(p.submitter)).toBeCloseTo(1, 5)
		})

		it("a negative loyal-only score still counts", async () => {
			const submitter = await seedKey()
			const targets = await lyrics(submitter, loyalMinVotes)
			await loyalKeys(targets, 1)
			await vote(await seedKey(), targets[0], -1)
			await vote(await seedKey(), targets[0], -1)
			await recalc(targets)

			const r = await row(targets[0])
			expect(r.loyal_only).toBe(true)
			expect(r.effective_score).toBeLessThan(0)
			expect(await boardScore(submitter)).toBeCloseTo(r.effective_score, 5)
		})
	})

	describe("edge cases", () => {
		it(`${loyalMinVotes - 1} upvotes to one submitter never make a key loyal`, async () => {
			const submitter = await seedKey()
			const targets = await lyrics(submitter, loyalMinVotes - 1)
			await loyalKeys(targets, 3)

			expect(await loyalOnly(targets[0])).toBe(false)
		})

		it("a key below the devoted share is not loyal", async () => {
			const submitter = await seedKey()
			const targets = await lyrics(submitter, loyalMinVotes)
			const other = await lyrics(await seedKey(), 2)
			const keys = await loyalKeys(targets, 3)
			for (const key of keys) await voteAll(key, other)

			expect(await loyalOnly(targets[0])).toBe(false)
		})

		it("ignores the submitter's own self upvote", async () => {
			const p = await propped()
			await vote(p.submitter, p.targets[0], 1, 1)

			expect(await loyalOnly(p.targets[0])).toBe(true)
		})

		it("ignores banned and discounted voters", async () => {
			const p = await propped()
			const banned = await seedKey()
			const discounted = await seedKey()
			await db.pool.query("UPDATE users SET banned_at = $1 WHERE id = $2", [NOW, banned])
			await db.pool.query("UPDATE users SET votes_discounted_at = $1 WHERE id = $2", [
				NOW,
				discounted,
			])
			await vote(banned, p.targets[0])
			await vote(discounted, p.targets[0])

			expect(await loyalOnly(p.targets[0])).toBe(true)
		})

		it("a lyric whose only upvotes come from uncounted voters is not loyal-only", async () => {
			const submitter = await seedKey()
			const targets = await lyrics(submitter, loyalMinVotes)
			const [banned] = await loyalKeys(targets, 1)
			await db.pool.query("UPDATE users SET banned_at = $1 WHERE id = $2", [NOW, banned])

			expect(await loyalOnly(targets[0])).toBe(false)
		})

		it("a lyric with no upvotes is not loyal-only", async () => {
			const id = await lyric(await seedKey())
			await vote(await seedKey(), id, -1)

			expect(await loyalOnly(id)).toBe(false)
		})

		it("a lyric with no submitter is never loyal-only", async () => {
			const id = await lyric(null)
			await loyalKeys([id, ...(await lyrics(await seedKey(), loyalMinVotes))], 1)

			expect(await loyalOnly(id)).toBe(false)
		})
	})

	describe("backfillConfidence", () => {
		it("keeps loyal-only lyrics low", async () => {
			const p = await propped()
			await recalc(p.targets)
			await db.pool.query("UPDATE lyrics SET confidence = 'medium' WHERE id = $1", [p.targets[0]])

			await backfillConfidence(db.env)

			expect((await row(p.targets[0])).confidence).toBe("low")
		})
	})

	describe("sweep in runVoteIntegrity", () => {
		async function staleFixture() {
			const submitter = await seedKey()
			const targets = await lyrics(submitter, loyalMinVotes)
			const keys = [await seedKey(), await seedKey(), await seedKey()]
			for (const key of keys) await vote(key, targets[0])
			await recalc([targets[0]])
			for (const key of keys) await voteAll(key, targets.slice(1))
			await recalc(targets.slice(1))
			return { submitter, targets, keys }
		}

		it("flips a stale row, drops it to low and revokes its confidence XP", async () => {
			const f = await staleFixture()
			expect(await row(f.targets[0])).toMatchObject({ loyal_only: false, confidence: "medium" })
			expect((await xpEvents(f.submitter)).map((e) => e.kind)).toEqual([
				"first-for-song",
				"reached-medium",
			])

			await runVoteIntegrity(db.env, NOW)

			expect(await row(f.targets[0])).toMatchObject({ loyal_only: true, confidence: "low" })
			expect(await xpEvents(f.submitter)).toEqual([])
		})

		it("evicts the feed and curator leaderboard caches when it changes something", async () => {
			await staleFixture()
			db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")
			db.cache.store.set("feed:global:20", "[]")

			await runVoteIntegrity(db.env, NOW)

			expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(false)
			expect(db.cache.store.has("feed:global:20")).toBe(false)
		})

		it("flips back when an independent upvote arrives", async () => {
			const f = await staleFixture()
			await runVoteIntegrity(db.env, NOW)
			await vote(await seedKey(), f.targets[0])

			await runVoteIntegrity(db.env, NOW)

			expect(await row(f.targets[0])).toMatchObject({ loyal_only: false, confidence: "medium" })
			expect((await xpEvents(f.submitter)).map((e) => e.kind)).toEqual([
				"first-for-song",
				"reached-medium",
			])
		})

		describe("invariants", () => {
			it("a second run changes nothing and leaves the caches alone", async () => {
				const f = await staleFixture()
				await runVoteIntegrity(db.env, NOW)
				const before = { lyric: await row(f.targets[0]), xp: await xpEvents(f.submitter) }
				db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")

				await runVoteIntegrity(db.env, NOW)

				expect({ lyric: await row(f.targets[0]), xp: await xpEvents(f.submitter) }).toEqual(before)
				expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(true)
			})

			it("the stored column matches the expression for every live lyric after a run", async () => {
				await staleFixture()
				await runVoteIntegrity(db.env, NOW)

				const { rows } = await db.pool.query(
					`SELECT l.id FROM lyrics l
					 WHERE l.deleted_at IS NULL AND l.loyal_only IS DISTINCT FROM ${LOYAL_ONLY_EXPR_JOINED}`
				)
				expect(rows).toEqual([])
			})

			it("does not touch XP of lyrics with independent voters", async () => {
				const f = await staleFixture()
				const open = await lyric(f.submitter)
				for (const key of [await seedKey(), await seedKey(), await seedKey()]) {
					await vote(key, open)
				}
				await recalc([open])

				await runVoteIntegrity(db.env, NOW)

				expect((await xpEvents(f.submitter)).map((e) => e.ref_id)).toEqual([open, open])
			})
		})

		describe("regressions", () => {
			it("regression: revokes XP from a lyric whose recalculation already marked it loyal-only", async () => {
				const f = await staleFixture()
				await recalc([f.targets[0]])
				expect(await row(f.targets[0])).toMatchObject({ loyal_only: true, confidence: "low" })
				expect(await xpEvents(f.submitter)).not.toEqual([])

				await runVoteIntegrity(db.env, NOW)

				expect(await xpEvents(f.submitter)).toEqual([])
			})

			it("regression: another user's XP event on a loyal-only lyric does not resweep it every run", async () => {
				const f = await staleFixture()
				await runVoteIntegrity(db.env, NOW)
				await db.pool.query(
					`INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id)
					 VALUES ($1, 10, 'reached-medium', 'lyric', $2)`,
					[f.keys[0], f.targets[0]]
				)
				db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")

				await runVoteIntegrity(db.env, NOW)

				expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(true)
			})

			it("regression: a deleted lyric is never swept", async () => {
				const f = await staleFixture()
				await db.pool.query(
					`UPDATE lyrics SET deleted_at = $1, deleted_by_user_id = submitter_id,
						deleted_by_role = 'submitter' WHERE id = $2`,
					[NOW, f.targets[0]]
				)

				await runVoteIntegrity(db.env, NOW)

				expect((await row(f.targets[0])).loyal_only).toBe(false)
			})
		})

		describe("error paths", () => {
			it("a lyric whose recalculation fails is retried on the next run", async () => {
				const f = await staleFixture()
				const g = await staleFixture()
				const release = await failLyricUpdates(f.targets[0])
				try {
					await runVoteIntegrity(db.env, NOW)
				} finally {
					await release()
				}
				expect((await row(f.targets[0])).loyal_only).toBe(false)
				expect((await row(g.targets[0])).loyal_only).toBe(true)
				expect(await xpEvents(g.submitter)).toEqual([])

				await runVoteIntegrity(db.env, NOW)

				expect(await row(f.targets[0])).toMatchObject({ loyal_only: true, confidence: "low" })
				expect(await xpEvents(f.submitter)).toEqual([])
			})
		})
	})
})
