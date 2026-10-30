import { COMMUNITY_KEY_ID, config } from "@/config"
import {
	addEvent,
	awardPenaltyXp,
	awardStrikePenaltyXp,
	getXp,
	revokeConfidenceXp,
} from "@/db/contribution-events"
import {
	type SuspectKey,
	findSuspectKeys,
	recordStrikes,
	revokeStrikeXp,
	undoStrike,
} from "@/db/vote-strikes"
import { recalculateScore } from "@/jobs/score-updater"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const T0 = 1793000000
const MINUTE = 60
const HOUR = 3600
const DAY = 86400

const {
	freshSec,
	devotedShare,
	ring,
	serialMinVotes,
	serialWindowSec,
	launchedAt,
	mergeWindowSec,
} = config.voteIntegrity

let db: IntegrationDb
let seq = 0

async function seedKey(createdAt: number, keyId = `vs-${++seq}`): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		"INSERT INTO users (key_id, created_at) VALUES ($1, $2) RETURNING id",
		[keyId, createdAt]
	)
	return rows[0].id
}

async function lyric(submitterId: number | null): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
			sync_type, submitter_id)
		 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2)
		 RETURNING id`,
		[`kJQP7kiw${String(++seq).padStart(3, "0")}`, submitterId]
	)
	return rows[0].id
}

async function lyrics(submitterId: number | null, count: number): Promise<number[]> {
	const ids: number[] = []
	for (let i = 0; i < count; i++) ids.push(await lyric(submitterId))
	return ids
}

const vote = (userId: number, lyricsId: number, at: number, self = 0) =>
	db.pool.query(
		"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at) VALUES ($1, $2, 1, $3, $4)",
		[lyricsId, userId, self, at]
	)

async function freshVoter(lyricsId: number, firstVoteAt: number): Promise<number> {
	const key = await seedKey(firstVoteAt - MINUTE)
	await vote(key, lyricsId, firstVoteAt)
	return key
}

async function freshVoters(lyricsId: number, firstVotes: number[]): Promise<number[]> {
	const keys: number[] = []
	for (const at of firstVotes) keys.push(await freshVoter(lyricsId, at))
	return keys
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

describeIntegration("findSuspectKeys", () => {
	const sortByUser = (rows: SuspectKey[]) => [...rows].sort((a, b) => a.userId - b.userId)
	const userIds = (rows: SuspectKey[]) => rows.map((r) => r.userId).sort((a, b) => a - b)

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	describe("vote direction and pace", () => {
		const downvote = (userId: number, lyricsId: number, at: number) =>
			db.pool.query(
				"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at) VALUES ($1, $2, -1, 0, $3)",
				[lyricsId, userId, at]
			)

		it("regression: a downvote raid never flags its target", async () => {
			const target = await seedKey(T0 - 60 * DAY)
			const targets = await lyrics(target, serialMinVotes * 2)
			for (let k = 0; k < ring.minKeys; k++) {
				const raider = await seedKey(T0 + k * MINUTE)
				for (const [i, lyricsId] of targets.entries()) {
					await downvote(raider, lyricsId, T0 + k * MINUTE + 30 + i * 10)
				}
			}

			expect(await findSuspectKeys(db.env)).toEqual([])
		})

		it("regression: a long-time fan who upvotes one submitter for months is not serial", async () => {
			const submitter = await seedKey(T0 - 300 * DAY)
			const fan = await seedKey(T0 - 200 * DAY)
			const targets = await lyrics(submitter, serialMinVotes * 4)
			for (const [i, lyricsId] of targets.entries()) {
				await vote(fan, lyricsId, T0 - 200 * DAY + 9 * MINUTE + i * DAY)
			}

			expect(await findSuspectKeys(db.env)).toEqual([])
		})

		it("a fresh key whose upvotes are spread over more than the window is not serial", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const key = await seedKey(T0)
			const gap = Math.ceil(serialWindowSec / (serialMinVotes - 1)) + 1
			for (const [i, lyricsId] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(key, lyricsId, T0 + MINUTE + i * gap)
			}

			expect(await findSuspectKeys(db.env)).toEqual([])
		})

		it("a key that is not fresh is not serial, however fast it votes", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const key = await seedKey(T0 - freshSec)
			for (const [i, lyricsId] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(key, lyricsId, T0 + i * 10)
			}

			expect(await findSuspectKeys(db.env)).toEqual([])
		})

		it("the window is inclusive: the last vote exactly serialWindowSec after the first counts", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const inside = await seedKey(T0)
			const outside = await seedKey(T0 + DAY)
			const step = serialWindowSec / (serialMinVotes - 1)
			for (const [i, lyricsId] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(inside, lyricsId, T0 + MINUTE + i * step)
			}
			for (const [i, lyricsId] of (await lyrics(submitter, serialMinVotes)).entries()) {
				const at = T0 + DAY + MINUTE + i * step + (i === serialMinVotes - 1 ? 1 : 0)
				await vote(outside, lyricsId, at)
			}

			const result = await findSuspectKeys(db.env)
			expect(result.map((r) => r.userId)).toEqual([inside])
			expect(result[0]).toMatchObject({ serial: true, ring: false })
		})

		it("downvotes neither count toward devotion nor toward the serial count", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const key = await seedKey(T0)
			const targets = await lyrics(submitter, serialMinVotes)
			for (const [i, lyricsId] of targets.slice(0, serialMinVotes - 1).entries()) {
				await vote(key, lyricsId, T0 + MINUTE + i * 10)
			}
			await downvote(key, targets[serialMinVotes - 1], T0 + 2 * MINUTE)

			expect(await findSuspectKeys(db.env)).toEqual([])
		})
	})

	it("flags a ring: 5 fresh keys on one submitter inside 3h", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const [first, second] = await lyrics(submitter, 2)
		const keys: number[] = []
		for (let i = 0; i < ring.minKeys; i++) {
			const signup = T0 + i * 25 * MINUTE
			const key = await seedKey(signup)
			await vote(key, first, signup + 2 * MINUTE)
			if (i % 2 === 0) await vote(key, second, signup + 4 * MINUTE)
			keys.push(key)
		}

		const result = sortByUser(await findSuspectKeys(db.env))

		expect(result).toEqual(
			keys.map((key, i) => ({
				userId: key,
				submitterId: submitter,
				votes: i % 2 === 0 ? 2 : 1,
				ring: true,
				serial: false,
				lastVoteAt: T0 + i * 25 * MINUTE + (i % 2 === 0 ? 4 : 2) * MINUTE,
			}))
		)
	})

	it("flags a serial key: 5 votes all on one submitter", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const targets = await lyrics(submitter, 11)
		const key = await seedKey(T0)
		for (const [i, target] of targets.entries()) await vote(key, target, T0 + 30 + i * 20)

		const result = await findSuspectKeys(db.env)

		expect(result).toEqual([
			{
				userId: key,
				submitterId: submitter,
				votes: 11,
				ring: false,
				serial: true,
				lastVoteAt: T0 + 30 + 10 * 20,
			},
		])
	})

	it("flags a dyp-style key every few days, each serial", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const targets = await lyrics(submitter, 6)
		const keys: number[] = []
		for (let i = 0; i < 3; i++) {
			const signup = T0 + i * 3 * DAY
			const key = await seedKey(signup)
			for (const [j, target] of targets.entries()) await vote(key, target, signup + 45 + j * 30)
			keys.push(key)
		}

		const result = sortByUser(await findSuspectKeys(db.env))

		expect(result.map((r) => r.userId)).toEqual(keys)
		for (const row of result) {
			expect(row).toMatchObject({ submitterId: submitter, votes: 6, ring: false, serial: true })
		}
	})

	it("does not flag honest one-time voters spread over weeks", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const target = await lyric(submitter)
		for (let i = 0; i < 10; i++) {
			const signup = T0 + i * 7 * DAY
			const key = await seedKey(signup)
			await vote(key, target, signup + 2 * MINUTE)
		}

		expect(await findSuspectKeys(db.env)).toEqual([])
	})

	it("does not flag an old key that votes on many submitters", async () => {
		const key = await seedKey(T0 - 90 * DAY)
		for (let s = 0; s < 5; s++) {
			const submitter = await seedKey(T0 - 120 * DAY)
			for (const [j, target] of (await lyrics(submitter, 2)).entries()) {
				await vote(key, target, T0 + s * 3 * DAY + j * HOUR)
			}
		}

		expect(await findSuspectKeys(db.env)).toEqual([])
	})

	it("does not flag the community account's voters", async () => {
		const community = await seedKey(T0 - 365 * DAY, COMMUNITY_KEY_ID)
		const targets = await lyrics(community, serialMinVotes + 1)
		await freshVoters(
			targets[0],
			Array.from({ length: ring.minKeys + 2 }, (_, i) => T0 + i * 10 * MINUTE)
		)
		const serialKey = await seedKey(T0)
		for (const [i, target] of targets.entries()) await vote(serialKey, target, T0 + 60 + i * 10)

		expect(await findSuspectKeys(db.env)).toEqual([])
	})

	it("skips keys already discounted and banned keys", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const targets = await lyrics(submitter, serialMinVotes + 1)
		const ringKeys = await freshVoters(
			targets[0],
			Array.from({ length: ring.minKeys + 1 }, (_, i) => T0 + i * 10 * MINUTE)
		)
		const [discounted, banned, ...rest] = ringKeys
		await db.pool.query("UPDATE users SET votes_discounted_at = $1 WHERE id = $2", [T0, discounted])
		await db.pool.query("UPDATE users SET banned_at = $1 WHERE id = $2", [T0, banned])
		const bannedSerial = await seedKey(T0 - 30 * DAY)
		for (const [i, target] of targets.entries()) await vote(bannedSerial, target, T0 + i * 60)
		await db.pool.query("UPDATE users SET banned_at = $1 WHERE id = $2", [T0, bannedSerial])

		const result = await findSuspectKeys(db.env)

		expect(userIds(result)).toEqual(sorted(rest))
		expect(result.every((r) => r.ring && r.submitterId === submitter)).toBe(true)
	})

	it("counts already-discounted keys as ring mates for a new fresh key", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const target = await lyric(submitter)
		const discounted = await freshVoters(
			target,
			Array.from({ length: ring.minKeys - 1 }, (_, i) => T0 + i * 15 * MINUTE)
		)
		for (const key of discounted) {
			await db.pool.query("UPDATE users SET votes_discounted_at = $1 WHERE id = $2", [
				T0 + 2 * HOUR,
				key,
			])
		}
		const newcomer = await freshVoter(target, T0 + 2 * HOUR + 30 * MINUTE)

		expect(await findSuspectKeys(db.env)).toEqual([
			{
				userId: newcomer,
				submitterId: submitter,
				votes: 1,
				ring: true,
				serial: false,
				lastVoteAt: T0 + 2 * HOUR + 30 * MINUTE,
			},
		])
	})

	it("skips keys the council cleared and still counts them as ring mates", async () => {
		const submitter = await seedKey(T0 - 60 * DAY)
		const target = await lyric(submitter)
		const cleared = await freshVoters(
			target,
			Array.from({ length: ring.minKeys - 1 }, (_, i) => T0 + i * 15 * MINUTE)
		)
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO vote_strikes (submitter_id, kind, detected_at, key_count, vote_count, repeat,
				backfill, undone_at, undone_by)
			VALUES ($1, 'ring', $2, $3, $3, FALSE, FALSE, $2, $1) RETURNING id`,
			[submitter, T0 + 2 * HOUR, cleared.length]
		)
		await db.pool.query("UPDATE users SET vote_strike_id = $1 WHERE id = ANY($2::int[])", [
			rows[0].id,
			cleared,
		])
		const newcomer = await freshVoter(target, T0 + 2 * HOUR + 30 * MINUTE)

		expect(await findSuspectKeys(db.env)).toEqual([
			{
				userId: newcomer,
				submitterId: submitter,
				votes: 1,
				ring: true,
				serial: false,
				lastVoteAt: T0 + 2 * HOUR + 30 * MINUTE,
			},
		])
	})

	describe("edge cases", () => {
		it("4 fresh keys is not a ring, 5 is", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const target = await lyric(submitter)
			const firstVotes = Array.from({ length: ring.minKeys }, (_, i) => T0 + i * 20 * MINUTE)
			const keys = await freshVoters(target, firstVotes.slice(0, -1))

			expect(await findSuspectKeys(db.env)).toEqual([])

			keys.push(await freshVoter(target, firstVotes[firstVotes.length - 1]))
			const result = await findSuspectKeys(db.env)

			expect(userIds(result)).toEqual(sorted(keys))
			expect(result.every((r) => r.ring && !r.serial)).toBe(true)
		})

		it("keys 3h apart are in one ring, 3h + 1s are not", async () => {
			const inside = await seedKey(T0 - 60 * DAY)
			const outside = await seedKey(T0 - 60 * DAY)
			const insideLyric = await lyric(inside)
			const outsideLyric = await lyric(outside)
			const together = Array.from({ length: ring.minKeys - 1 }, () => T0)
			const insideKeys = await freshVoters(insideLyric, [...together, T0 + ring.windowSec])
			await freshVoters(outsideLyric, [...together, T0 + ring.windowSec + 1])

			const result = await findSuspectKeys(db.env)

			expect(userIds(result)).toEqual(sorted(insideKeys))
			expect(result.every((r) => r.ring && r.submitterId === inside)).toBe(true)
		})

		it("first vote at 599s is fresh, 600s is not", async () => {
			const freshSubmitter = await seedKey(T0 - 60 * DAY)
			const staleSubmitter = await seedKey(T0 - 60 * DAY)
			const freshLyric = await lyric(freshSubmitter)
			const staleLyric = await lyric(staleSubmitter)
			const mates = Array.from({ length: ring.minKeys - 1 }, (_, i) => T0 + i * 10 * MINUTE)
			const freshKeys = await freshVoters(freshLyric, mates)
			const edgeFresh = await seedKey(T0)
			await vote(edgeFresh, freshLyric, T0 + freshSec - 1)
			await freshVoters(staleLyric, mates)
			const edgeStale = await seedKey(T0)
			await vote(edgeStale, staleLyric, T0 + freshSec)

			const result = await findSuspectKeys(db.env)

			expect(userIds(result)).toEqual(sorted([...freshKeys, edgeFresh]))
			expect(result.every((r) => r.ring && r.submitterId === freshSubmitter)).toBe(true)
		})

		it("4 votes is not serial, 5 is", async () => {
			const below = await seedKey(T0 - 60 * DAY)
			const at = await seedKey(T0 - 60 * DAY)
			const belowKey = await seedKey(T0 - MINUTE)
			const atKey = await seedKey(T0 - MINUTE)
			for (const [i, target] of (await lyrics(below, serialMinVotes - 1)).entries()) {
				await vote(belowKey, target, T0 + i * MINUTE)
			}
			for (const [i, target] of (await lyrics(at, serialMinVotes)).entries()) {
				await vote(atKey, target, T0 + i * MINUTE)
			}

			expect(await findSuspectKeys(db.env)).toEqual([
				{
					userId: atKey,
					submitterId: at,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: T0 + (serialMinVotes - 1) * MINUTE,
				},
			])
		})
	})

	describe("regressions", () => {
		it("a sock that adds one stray vote elsewhere (5 of 6) is still devoted", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const other = await seedKey(T0 - 60 * DAY)
			const sock = await seedKey(T0)
			for (const [i, target] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(sock, target, T0 + 60 + i * 30)
			}
			await vote(sock, await lyric(other), T0 + HOUR)
			expect(serialMinVotes / (serialMinVotes + 1)).toBeGreaterThanOrEqual(devotedShare)

			expect(await findSuspectKeys(db.env)).toEqual([
				{
					userId: sock,
					submitterId: submitter,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: T0 + 60 + (serialMinVotes - 1) * 30,
				},
			])
		})
	})

	describe("invariants", () => {
		it("self votes never count toward devotion", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const other = await seedKey(T0 - 60 * DAY)
			const voter = await seedKey(T0 + HOUR - MINUTE)
			for (const [i, own] of (await lyrics(voter, 10)).entries()) {
				await vote(voter, own, T0 + i * 60, 1)
			}
			for (const [i, target] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(voter, target, T0 + HOUR + i * 60)
			}
			await vote(voter, await lyric(other), T0 + 2 * HOUR)
			const selfOnly = await seedKey(T0 - 30 * DAY)
			for (const [i, own] of (await lyrics(selfOnly, 10)).entries()) {
				await vote(selfOnly, own, T0 + i * 60, 1)
			}

			expect(await findSuspectKeys(db.env)).toEqual([
				{
					userId: voter,
					submitterId: submitter,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: T0 + HOUR + (serialMinVotes - 1) * 60,
				},
			])
		})

		it("a key maps to at most one submitter", async () => {
			expect(devotedShare).toBeGreaterThan(0.5)
			const a = await seedKey(T0 - 60 * DAY)
			const b = await seedKey(T0 - 60 * DAY)
			const aLyrics = await lyrics(a, serialMinVotes)
			const bLyrics = await lyrics(b, serialMinVotes)
			const splitKey = await seedKey(T0)
			for (const [i, target] of [...aLyrics, ...bLyrics].entries()) {
				await vote(splitKey, target, T0 + 60 + i * 30)
			}
			const ringKeys = await freshVoters(
				aLyrics[0],
				Array.from({ length: ring.minKeys }, (_, i) => T0 + i * 10 * MINUTE)
			)
			const serialKey = await seedKey(T0 - MINUTE)
			for (const [i, target] of bLyrics.entries()) await vote(serialKey, target, T0 + i * MINUTE)
			for (const [i, target] of aLyrics.slice(1).entries()) {
				await vote(ringKeys[0], target, T0 + MINUTE + i * 60)
			}

			const result = await findSuspectKeys(db.env)

			expect(new Set(result.map((r) => r.userId)).size).toBe(result.length)
			expect(userIds(result)).toEqual(sorted([...ringKeys, serialKey]))
			expect(result.find((r) => r.userId === ringKeys[0])).toMatchObject({
				submitterId: a,
				votes: serialMinVotes,
				ring: true,
				serial: true,
			})
		})
	})

	describe("error paths", () => {
		it("returns nothing when there are no votes", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			await lyrics(submitter, 3)
			await seedKey(T0)

			expect(await findSuspectKeys(db.env)).toEqual([])
		})

		it("ignores votes on lyrics with no submitter", async () => {
			const orphans = await lyrics(null, 10)
			const orphanOnly = await seedKey(T0)
			for (const [i, target] of orphans.entries()) await vote(orphanOnly, target, T0 + 60 + i * 30)
			const submitter = await seedKey(T0 - 60 * DAY)
			const mixed = await seedKey(T0 + HOUR - MINUTE)
			for (const [i, target] of orphans.entries()) await vote(mixed, target, T0 + i * 60)
			for (const [i, target] of (await lyrics(submitter, serialMinVotes)).entries()) {
				await vote(mixed, target, T0 + HOUR + i * 60)
			}

			expect(await findSuspectKeys(db.env)).toEqual([
				{
					userId: mixed,
					submitterId: submitter,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: T0 + HOUR + (serialMinVotes - 1) * 60,
				},
			])
		})

		it("skips banned keys", async () => {
			const submitter = await seedKey(T0 - 60 * DAY)
			const banned = await seedKey(T0)
			for (const [i, target] of (await lyrics(submitter, serialMinVotes * 2)).entries()) {
				await vote(banned, target, T0 + 60 + i * 30)
			}
			await db.pool.query("UPDATE users SET banned_at = $1 WHERE id = $2", [T0 + HOUR, banned])

			expect(await findSuspectKeys(db.env)).toEqual([])
		})
	})
})

describeIntegration("recordStrikes", () => {
	const NOW = launchedAt + 10 * DAY

	interface StrikeRow {
		submitter_id: number
		kind: string
		detected_at: number
		key_count: number
		vote_count: number
		repeat: boolean
		backfill: boolean
		undone_at: number | null
	}

	async function submitterWithLyrics(): Promise<{ id: number; targets: number[] }> {
		const id = await seedKey(T0 - 60 * DAY)
		return { id, targets: await lyrics(id, serialMinVotes) }
	}

	async function serialKey(targets: number[], lastVoteAt: number): Promise<number> {
		const key = await seedKey(lastVoteAt - targets.length * MINUTE)
		for (const [i, target] of targets.entries()) {
			await vote(key, target, lastVoteAt - (targets.length - 1 - i) * MINUTE)
		}
		return key
	}

	const detectAndRecord = async (now: number) =>
		recordStrikes(db.env, await findSuspectKeys(db.env), now)

	async function strike(id: number): Promise<StrikeRow> {
		const { rows } = await db.pool.query<StrikeRow>(
			`SELECT submitter_id, kind, detected_at, key_count, vote_count, repeat, backfill, undone_at
			 FROM vote_strikes WHERE id = $1`,
			[id]
		)
		return rows[0]
	}

	async function strikeCount(): Promise<number> {
		const { rows } = await db.pool.query<{ n: number }>(
			"SELECT COUNT(*)::int AS n FROM vote_strikes"
		)
		return rows[0].n
	}

	async function markedKeys(strikeId: number): Promise<number[]> {
		const { rows } = await db.pool.query<{ id: number }>(
			"SELECT id FROM users WHERE vote_strike_id = $1 ORDER BY id",
			[strikeId]
		)
		return rows.map((r) => r.id)
	}

	async function keyState(userId: number) {
		const { rows } = await db.pool.query<{
			votes_discounted_at: number | null
			vote_strike_id: number | null
		}>("SELECT votes_discounted_at, vote_strike_id FROM users WHERE id = $1", [userId])
		return rows[0]
	}

	async function expectKeyCountsMatchMarkedKeys(): Promise<void> {
		const { rows } = await db.pool.query<{ key_count: number; marked: number }>(
			`SELECT s.key_count, COUNT(u.id)::int AS marked
			 FROM vote_strikes s LEFT JOIN users u ON u.vote_strike_id = s.id
			 GROUP BY s.id, s.key_count`
		)
		expect(rows.length).toBeGreaterThan(0)
		for (const row of rows) expect(row.key_count).toBe(row.marked)
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

	it("first detection after launch inserts a strike and marks its keys", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const key = await serialKey(targets, NOW - HOUR)

		const result = await detectAndRecord(NOW)

		expect(result).toEqual([
			{
				strikeId: expect.any(Number),
				submitterId: submitter,
				created: true,
				repeat: false,
				keyIds: [key],
			},
		])
		expect(await strike(result[0].strikeId)).toEqual({
			submitter_id: submitter,
			kind: "serial",
			detected_at: NOW,
			key_count: 1,
			vote_count: serialMinVotes,
			repeat: false,
			backfill: false,
			undone_at: null,
		})
		expect(await keyState(key)).toEqual({
			votes_discounted_at: NOW,
			vote_strike_id: result[0].strikeId,
		})
	})

	it("a detection 25h later with new keys inserts a repeat strike", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const first = await serialKey(targets, NOW - HOUR)
		const [earlier] = await detectAndRecord(NOW)
		const later = NOW + mergeWindowSec + HOUR
		const second = await serialKey(targets, later - HOUR)

		const result = await detectAndRecord(later)

		expect(result).toEqual([
			{
				strikeId: expect.any(Number),
				submitterId: submitter,
				created: true,
				repeat: true,
				keyIds: [second],
			},
		])
		expect(result[0].strikeId).not.toBe(earlier.strikeId)
		expect(await strike(result[0].strikeId)).toMatchObject({
			detected_at: later,
			key_count: 1,
			repeat: true,
			backfill: false,
		})
		expect(await markedKeys(earlier.strikeId)).toEqual([first])
		expect(await markedKeys(result[0].strikeId)).toEqual([second])
	})

	it("a detection 23h later merges into the open strike", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const first = await serialKey(targets, NOW - HOUR)
		const [earlier] = await detectAndRecord(NOW)
		const later = NOW + mergeWindowSec - HOUR
		const second = await serialKey(targets, later - HOUR)

		const result = await detectAndRecord(later)

		expect(result).toEqual([
			{
				strikeId: earlier.strikeId,
				submitterId: submitter,
				created: false,
				repeat: false,
				keyIds: [second],
			},
		])
		expect(await strike(earlier.strikeId)).toMatchObject({
			kind: "serial",
			detected_at: NOW,
			key_count: 2,
			vote_count: 2 * serialMinVotes,
			repeat: false,
		})
		expect(await markedKeys(earlier.strikeId)).toEqual(sorted([first, second]))
		expect(await keyState(second)).toEqual({
			votes_discounted_at: later,
			vote_strike_id: earlier.strikeId,
		})
		expect(await strikeCount()).toBe(1)
	})

	it("history before launch is a backfill strike that is never a repeat", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		await serialKey(targets, NOW - HOUR)
		const [earlier] = await detectAndRecord(NOW)
		const later = NOW + 2 * DAY
		const old = await serialKey(targets, launchedAt - DAY)

		const result = await detectAndRecord(later)

		expect(result).toEqual([
			{
				strikeId: expect.any(Number),
				submitterId: submitter,
				created: true,
				repeat: false,
				keyIds: [old],
			},
		])
		expect(await strike(earlier.strikeId)).toMatchObject({ backfill: false, repeat: false })
		expect(await strike(result[0].strikeId)).toMatchObject({
			detected_at: later,
			backfill: true,
			repeat: false,
		})
	})

	it("a first strike from history before launch is a backfill strike", async () => {
		const { targets } = await submitterWithLyrics()
		await serialKey(targets, launchedAt - 1)

		const [result] = await detectAndRecord(NOW)

		expect(result).toMatchObject({ created: true, repeat: false })
		expect(await strike(result.strikeId)).toMatchObject({ backfill: true, repeat: false })
	})

	it("an undone strike neither makes the next one a repeat nor takes new keys", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const first = await serialKey(targets, NOW - HOUR)
		const [earlier] = await detectAndRecord(NOW)
		await db.pool.query("UPDATE vote_strikes SET undone_at = $1 WHERE id = $2", [
			NOW + HOUR,
			earlier.strikeId,
		])
		const second = await serialKey(targets, NOW + HOUR)

		const result = await detectAndRecord(NOW + 2 * HOUR)

		expect(result).toEqual([
			{
				strikeId: expect.any(Number),
				submitterId: submitter,
				created: true,
				repeat: false,
				keyIds: [second],
			},
		])
		expect(result[0].strikeId).not.toBe(earlier.strikeId)
		expect(await strike(earlier.strikeId)).toMatchObject({ key_count: 1, undone_at: NOW + HOUR })
		expect(await markedKeys(earlier.strikeId)).toEqual([first])
	})

	it("kind becomes both when serial keys merge into a ring strike", async () => {
		const { targets } = await submitterWithLyrics()
		const ringKeys = await freshVoters(
			targets[0],
			Array.from({ length: ring.minKeys }, (_, i) => NOW - 2 * HOUR + i * 10 * MINUTE)
		)
		const [ringStrike] = await detectAndRecord(NOW)
		expect(await strike(ringStrike.strikeId)).toMatchObject({
			kind: "ring",
			key_count: ring.minKeys,
			vote_count: ring.minKeys,
		})
		const serial = await serialKey(targets, NOW + 30 * MINUTE)

		const result = await detectAndRecord(NOW + HOUR)

		expect(result).toEqual([
			{
				strikeId: ringStrike.strikeId,
				submitterId: ringStrike.submitterId,
				created: false,
				repeat: false,
				keyIds: [serial],
			},
		])
		expect(await strike(ringStrike.strikeId)).toMatchObject({
			kind: "both",
			key_count: ring.minKeys + 1,
			vote_count: ring.minKeys + serialMinVotes,
		})
		expect(await markedKeys(ringStrike.strikeId)).toEqual(sorted([...ringKeys, serial]))
	})

	it("running detection and recording twice without new keys writes nothing the second time", async () => {
		const { targets } = await submitterWithLyrics()
		await serialKey(targets, NOW - HOUR)
		await serialKey(targets, NOW - 2 * HOUR)
		await detectAndRecord(NOW)
		const snapshot = async () => ({
			strikes: (await db.pool.query("SELECT * FROM vote_strikes ORDER BY id")).rows,
			users: (
				await db.pool.query("SELECT id, votes_discounted_at, vote_strike_id FROM users ORDER BY id")
			).rows,
		})
		const before = await snapshot()

		expect(await detectAndRecord(NOW + HOUR)).toEqual([])
		expect(await snapshot()).toEqual(before)
	})

	describe("council and penalty events", () => {
		async function councilEvents() {
			const { rows } = await db.pool.query(
				"SELECT actor_id, kind, source, subject_user_id, ref_id, note, created_at FROM council_events ORDER BY id"
			)
			return rows
		}

		async function penaltyEvents() {
			const { rows } = await db.pool.query(
				"SELECT user_id, delta, ref_id FROM contribution_events WHERE kind = 'vote-manipulation' ORDER BY id"
			)
			return rows
		}

		async function settledAt(strikeId: number): Promise<number | null> {
			const { rows } = await db.pool.query<{ settled_at: number | null }>(
				"SELECT settled_at FROM vote_strikes WHERE id = $1",
				[strikeId]
			)
			return rows[0].settled_at
		}

		it("a new strike writes its vote_strike council event and is not settled yet", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			await serialKey(targets, NOW - HOUR)

			const [result] = await detectAndRecord(NOW)

			expect(await councilEvents()).toEqual([
				{
					actor_id: null,
					kind: "vote_strike",
					source: "system",
					subject_user_id: submitter,
					ref_id: String(result.strikeId),
					note: `serial: 1 key, ${serialMinVotes} votes`,
					created_at: NOW,
				},
			])
			expect(await settledAt(result.strikeId)).toBeNull()
			expect(await penaltyEvents()).toEqual([])
		})

		it("a repeat strike writes its penalty event with the strike", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			await serialKey(targets, NOW - HOUR)
			await detectAndRecord(NOW)
			await serialKey(targets, NOW + 2 * DAY - HOUR)

			const [repeat] = await detectAndRecord(NOW + 2 * DAY)

			expect(repeat).toMatchObject({ created: true, repeat: true })
			expect(await penaltyEvents()).toEqual([
				{
					user_id: submitter,
					delta: config.voteIntegrity.repeatPenalty.xp,
					ref_id: repeat.strikeId,
				},
			])
			expect((await councilEvents()).map((e) => e.note)).toEqual([
				`serial: 1 key, ${serialMinVotes} votes`,
				`serial: 1 key, ${serialMinVotes} votes (repeat)`,
			])
		})

		it("a merge writes no second council event and marks the strike unsettled", async () => {
			const { targets } = await submitterWithLyrics()
			await serialKey(targets, NOW - HOUR)
			const [first] = await detectAndRecord(NOW)
			await db.pool.query("UPDATE vote_strikes SET settled_at = $1 WHERE id = $2", [
				NOW,
				first.strikeId,
			])
			await serialKey(targets, NOW + HOUR)

			const [merged] = await detectAndRecord(NOW + 2 * HOUR)

			expect(merged).toMatchObject({ strikeId: first.strikeId, created: false })
			expect(await settledAt(first.strikeId)).toBeNull()
			expect(await councilEvents()).toHaveLength(1)
			expect(await penaltyEvents()).toEqual([])
		})

		it("regression: a council event that cannot be written rolls the whole strike back", async () => {
			const { targets } = await submitterWithLyrics()
			const key = await serialKey(targets, NOW - HOUR)
			await db.pool.query(
				`CREATE OR REPLACE FUNCTION vs_fail() RETURNS trigger AS $$
				BEGIN RAISE EXCEPTION 'blocked'; END $$ LANGUAGE plpgsql`
			)
			await db.pool.query(
				"CREATE TRIGGER vs_fail BEFORE INSERT ON council_events FOR EACH ROW EXECUTE FUNCTION vs_fail()"
			)
			try {
				expect(await detectAndRecord(NOW)).toEqual([])
			} finally {
				await db.pool.query("DROP TRIGGER vs_fail ON council_events")
				await db.pool.query("DROP FUNCTION vs_fail()")
			}

			expect(await strikeCount()).toBe(0)
			expect(await keyState(key)).toEqual({ votes_discounted_at: null, vote_strike_id: null })
			expect(await councilEvents()).toEqual([])
		})
	})

	describe("regressions", () => {
		it("regression: a backfill strike never makes a later live strike a repeat", async () => {
			const { targets } = await submitterWithLyrics()
			await serialKey(targets, launchedAt - DAY)
			const [backfill] = await detectAndRecord(NOW)
			const live = await serialKey(targets, NOW + 2 * DAY - HOUR)

			const [result] = await detectAndRecord(NOW + 2 * DAY)

			expect(result).toMatchObject({ created: true, repeat: false, keyIds: [live] })
			expect(await strike(backfill.strikeId)).toMatchObject({ backfill: true, repeat: false })
			expect(await strike(result.strikeId)).toMatchObject({ backfill: false, repeat: false })
		})

		it("regression: a live detection within 24h of a backfill strike is a new first strike", async () => {
			const { targets } = await submitterWithLyrics()
			const old = await serialKey(targets, launchedAt - DAY)
			const [backfill] = await detectAndRecord(NOW)
			const live = await serialKey(targets, NOW + HOUR)

			const [result] = await detectAndRecord(NOW + 2 * HOUR)

			expect(result).toMatchObject({ created: true, repeat: false, keyIds: [live] })
			expect(result.strikeId).not.toBe(backfill.strikeId)
			expect(await strike(backfill.strikeId)).toMatchObject({ key_count: 1, backfill: true })
			expect(await markedKeys(backfill.strikeId)).toEqual([old])
			expect(await markedKeys(result.strikeId)).toEqual([live])
			expect(await strikeCount()).toBe(2)
		})

		it("a live strike after a backfill and a first live strike is still a repeat", async () => {
			const { targets } = await submitterWithLyrics()
			await serialKey(targets, launchedAt - DAY)
			await detectAndRecord(NOW)
			await serialKey(targets, NOW + 2 * DAY - HOUR)
			await detectAndRecord(NOW + 2 * DAY)
			await serialKey(targets, NOW + 4 * DAY - HOUR)

			const [result] = await detectAndRecord(NOW + 4 * DAY)

			expect(result).toMatchObject({ created: true, repeat: true })
		})
	})

	describe("edge cases", () => {
		it("exactly mergeWindowSec apart merges, one second more inserts", async () => {
			const a = await submitterWithLyrics()
			const b = await submitterWithLyrics()
			await serialKey(a.targets, NOW - HOUR)
			await serialKey(b.targets, NOW - HOUR)
			const first = await detectAndRecord(NOW)
			const a2 = await serialKey(a.targets, NOW + HOUR)
			const b2 = await serialKey(b.targets, NOW + HOUR)
			const suspects = await findSuspectKeys(db.env)

			const atEdge = await recordStrikes(
				db.env,
				suspects.filter((s) => s.submitterId === a.id),
				NOW + mergeWindowSec
			)
			const past = await recordStrikes(
				db.env,
				suspects.filter((s) => s.submitterId === b.id),
				NOW + mergeWindowSec + 1
			)

			expect(atEdge).toEqual([
				{
					strikeId: first.find((s) => s.submitterId === a.id)?.strikeId,
					submitterId: a.id,
					created: false,
					repeat: false,
					keyIds: [a2],
				},
			])
			expect(past).toEqual([
				{
					strikeId: expect.any(Number),
					submitterId: b.id,
					created: true,
					repeat: true,
					keyIds: [b2],
				},
			])
			expect(past[0].strikeId).not.toBe(first.find((s) => s.submitterId === b.id)?.strikeId)
		})

		it("empty input returns nothing and writes nothing", async () => {
			expect(await recordStrikes(db.env, [], NOW)).toEqual([])
			expect(await strikeCount()).toBe(0)
		})

		it("two submitters in one call get independent strikes", async () => {
			const a = await submitterWithLyrics()
			const b = await submitterWithLyrics()
			const aKeys = [await serialKey(a.targets, NOW - HOUR), await serialKey(a.targets, NOW - HOUR)]
			const bKey = await serialKey(b.targets, NOW - 2 * HOUR)

			const result = await detectAndRecord(NOW)

			const forA = result.find((s) => s.submitterId === a.id)
			const forB = result.find((s) => s.submitterId === b.id)
			expect(result).toHaveLength(2)
			expect(forA).toMatchObject({ created: true, repeat: false })
			expect(forB).toMatchObject({ created: true, repeat: false, keyIds: [bKey] })
			expect(sorted(forA?.keyIds ?? [])).toEqual(sorted(aKeys))
			expect(forA?.strikeId).not.toBe(forB?.strikeId)
			expect(await strike(forA?.strikeId ?? 0)).toMatchObject({
				submitter_id: a.id,
				key_count: 2,
				vote_count: 2 * serialMinVotes,
			})
			expect(await strike(forB?.strikeId ?? 0)).toMatchObject({
				submitter_id: b.id,
				key_count: 1,
				vote_count: serialMinVotes,
			})
			expect(await markedKeys(forA?.strikeId ?? 0)).toEqual(sorted(aKeys))
			expect(await markedKeys(forB?.strikeId ?? 0)).toEqual([bKey])
		})
	})

	describe("invariants", () => {
		it("key_count always equals the number of keys pointing at the strike", async () => {
			const { targets } = await submitterWithLyrics()
			await serialKey(targets, NOW - HOUR)
			await detectAndRecord(NOW)
			await expectKeyCountsMatchMarkedKeys()

			await serialKey(targets, NOW + HOUR)
			await detectAndRecord(NOW + 2 * HOUR)
			await expectKeyCountsMatchMarkedKeys()

			await serialKey(targets, NOW + 2 * DAY)
			await serialKey(targets, NOW + 2 * DAY)
			await detectAndRecord(NOW + 2 * DAY + HOUR)
			await expectKeyCountsMatchMarkedKeys()
			expect(await strikeCount()).toBe(2)
		})

		it("a key already discounted is never re-pointed to a newer strike", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			const discounted = await serialKey(targets, NOW - HOUR)
			const [earlier] = await detectAndRecord(NOW)
			const fresh = await serialKey(targets, NOW + DAY)
			const stale: SuspectKey = {
				userId: discounted,
				submitterId: submitter,
				votes: serialMinVotes,
				ring: false,
				serial: true,
				lastVoteAt: NOW - HOUR,
			}
			const later = NOW + 2 * DAY

			expect(await recordStrikes(db.env, [stale], later)).toEqual([])
			expect(await strikeCount()).toBe(1)

			const result = await recordStrikes(
				db.env,
				[stale, { ...stale, userId: fresh, lastVoteAt: NOW + DAY }],
				later
			)

			expect(result).toEqual([
				{
					strikeId: expect.any(Number),
					submitterId: submitter,
					created: true,
					repeat: true,
					keyIds: [fresh],
				},
			])
			expect(await keyState(discounted)).toEqual({
				votes_discounted_at: NOW,
				vote_strike_id: earlier.strikeId,
			})
			expect(await strike(result[0].strikeId)).toMatchObject({
				key_count: 1,
				vote_count: serialMinVotes,
			})
			await expectKeyCountsMatchMarkedKeys()
		})
	})

	describe("error paths", () => {
		it("rolls back a submitter whose strike cannot be written and commits the others", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			const key = await serialKey(targets, NOW - HOUR)
			const orphanKey = await seedKey(NOW - DAY)
			const { rows } = await db.pool.query<{ id: number }>(
				"SELECT COALESCE(MAX(id), 0) + 1000 AS id FROM users"
			)
			const missingSubmitter = rows[0].id
			const suspects: SuspectKey[] = [
				{
					userId: orphanKey,
					submitterId: missingSubmitter,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: NOW - HOUR,
				},
				...(await findSuspectKeys(db.env)),
			]

			const result = await recordStrikes(db.env, suspects, NOW)

			expect(result).toEqual([
				{
					strikeId: expect.any(Number),
					submitterId: submitter,
					created: true,
					repeat: false,
					keyIds: [key],
				},
			])
			const { rows: missingStrikes } = await db.pool.query(
				"SELECT id FROM vote_strikes WHERE submitter_id = $1",
				[missingSubmitter]
			)
			expect(missingStrikes).toEqual([])
			expect(await keyState(orphanKey)).toEqual({ votes_discounted_at: null, vote_strike_id: null })
			expect(await strikeCount()).toBe(1)
		})
	})
})

describeIntegration("revokeStrikeXp", () => {
	const NOW = launchedAt + 10 * DAY
	const { weights } = config.gamification.xp

	interface Scenario {
		submitter: number
		dropped: number
		stays: number
		untouched: number
		socks: number[]
		strikeId: number
	}

	async function honestVote(lyricsId: number): Promise<number> {
		const key = await seedKey(NOW - 90 * DAY)
		await vote(key, lyricsId, NOW - 2 * HOUR)
		return key
	}

	async function sock(targets: number[], avgVote: number): Promise<number> {
		const key = await seedKey(NOW - HOUR - MINUTE)
		await db.pool.query("UPDATE users SET avg_vote = $1 WHERE id = $2", [avgVote, key])
		for (const [i, target] of targets.entries()) await vote(key, target, NOW - HOUR + i * MINUTE)
		return key
	}

	const recalculate = async (ids: number[]) => {
		for (const id of ids) await recalculateScore(db.env, id)
	}

	async function votedLyrics(keyIds: number[]): Promise<number[]> {
		const { rows } = await db.pool.query<{ id: number }>(
			"SELECT DISTINCT lyrics_id AS id FROM votes WHERE user_id = ANY($1::int[]) ORDER BY 1",
			[keyIds]
		)
		return rows.map((r) => r.id)
	}

	async function detect(): Promise<number> {
		const strikes = await recordStrikes(db.env, await findSuspectKeys(db.env), NOW)
		expect(strikes).toHaveLength(1)
		await recalculate(await votedLyrics(strikes[0].keyIds))
		return strikes[0].strikeId
	}

	async function scenario(): Promise<Scenario> {
		const submitter = await seedKey(NOW - 60 * DAY)
		const targets = await lyrics(submitter, serialMinVotes)
		const [dropped, stays] = targets
		await honestVote(dropped)
		for (let i = 0; i < 3; i++) await honestVote(stays)
		const socks = [await sock(targets, -0.5), await sock(targets, 0)]
		const untouched = await lyric(submitter)
		const untouchedVoters = [
			await honestVote(untouched),
			await honestVote(untouched),
			await honestVote(untouched),
		]
		await recalculate([...targets, untouched])
		await db.pool.query("DELETE FROM votes WHERE lyrics_id = $1 AND user_id = ANY($2::int[])", [
			untouched,
			untouchedVoters.slice(0, 2),
		])
		await recalculate([untouched])
		return { submitter, dropped, stays, untouched, socks, strikeId: await detect() }
	}

	async function kinds(userId: number, lyricsId: number): Promise<string[]> {
		const { rows } = await db.pool.query<{ kind: string }>(
			"SELECT kind FROM contribution_events WHERE user_id = $1 AND ref_type = 'lyric' AND ref_id = $2 ORDER BY kind",
			[userId, lyricsId]
		)
		return rows.map((r) => r.kind)
	}

	async function confidence(lyricsId: number): Promise<string> {
		const { rows } = await db.pool.query<{ confidence: string }>(
			"SELECT confidence FROM lyrics WHERE id = $1",
			[lyricsId]
		)
		return rows[0].confidence
	}

	async function xpRevoked(strikeId: number): Promise<number> {
		const { rows } = await db.pool.query<{ xp_revoked: number }>(
			"SELECT xp_revoked FROM vote_strikes WHERE id = $1",
			[strikeId]
		)
		return rows[0].xp_revoked
	}

	async function allEvents(): Promise<{ user_id: number; kind: string; ref_id: number }[]> {
		const { rows } = await db.pool.query<{ user_id: number; kind: string; ref_id: number }>(
			"SELECT user_id, kind, ref_id FROM contribution_events ORDER BY user_id, kind, ref_type, ref_id"
		)
		return rows
	}

	const mediumHighFirst = ["first-for-song", "reached-high", "reached-medium"]

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("takes back the xp of a lyric that drops to low once the socks are discounted", async () => {
		const s = await scenario()
		expect(await confidence(s.dropped)).toBe("low")
		expect(await kinds(s.submitter, s.dropped)).toEqual(mediumHighFirst)
		const before = await getXp(db.env, s.submitter)

		const revoked = await revokeStrikeXp(db.env, s.strikeId)

		const expected =
			weights.reachedMedium + weights.reachedHigh + weights.firstForSong + weights.reachedHigh
		expect(revoked).toBe(expected)
		expect(await xpRevoked(s.strikeId)).toBe(expected)
		expect(await kinds(s.submitter, s.dropped)).toEqual([])
		expect(await getXp(db.env, s.submitter)).toBe(before - expected)
	})

	it("takes back only reached-high of a lyric that drops to medium on honest votes", async () => {
		const s = await scenario()
		expect(await confidence(s.stays)).toBe("medium")
		expect(await kinds(s.submitter, s.stays)).toEqual(mediumHighFirst)

		await revokeStrikeXp(db.env, s.strikeId)

		expect(await kinds(s.submitter, s.stays)).toEqual(["first-for-song", "reached-medium"])
	})

	it("keeps the xp of a low lyric the strike keys did not vote on", async () => {
		const s = await scenario()
		expect(await confidence(s.untouched)).toBe("low")
		expect(await kinds(s.submitter, s.untouched)).toEqual(["first-for-song", "reached-medium"])

		await revokeStrikeXp(db.env, s.strikeId)

		expect(await kinds(s.submitter, s.untouched)).toEqual(["first-for-song", "reached-medium"])
	})

	it("leaves other users, other kinds and badge awards alone", async () => {
		const s = await scenario()
		const other = await seedKey(NOW - 60 * DAY)
		await addEvent(db.env, {
			userId: other,
			delta: weights.reachedMedium,
			kind: "reached-medium",
			refType: "lyric",
			refId: s.dropped,
		})
		await addEvent(db.env, {
			userId: s.submitter,
			delta: weights.consensusVote,
			kind: "consensus-vote",
			refType: "lyric",
			refId: s.dropped,
		})
		await addEvent(db.env, {
			userId: s.submitter,
			delta: weights.requestFilled,
			kind: "request-filled",
			refType: "fulfillment",
			refId: s.dropped,
		})
		await awardPenaltyXp(db.env, s.submitter, s.dropped)
		await db.pool.query("INSERT INTO badge_awards (user_id, badge_key) VALUES ($1, 'first-sync')", [
			s.submitter,
		])
		const before = await allEvents()

		await revokeStrikeXp(db.env, s.strikeId)

		const removed = new Set([
			...mediumHighFirst.map((kind) => JSON.stringify([s.submitter, kind, s.dropped])),
			JSON.stringify([s.submitter, "reached-high", s.stays]),
		])
		expect(await allEvents()).toEqual(
			before.filter((e) => !removed.has(JSON.stringify([e.user_id, e.kind, e.ref_id])))
		)
		expect(await kinds(s.submitter, s.dropped)).toEqual(["consensus-vote", "penalized"])
		const { rows } = await db.pool.query("SELECT user_id, badge_key FROM badge_awards")
		expect(rows).toEqual([{ user_id: s.submitter, badge_key: "first-sync" }])
	})

	describe("regressions", () => {
		it("regression: a lyric that later climbs to medium on honest votes earns it again", async () => {
			const s = await scenario()
			await revokeStrikeXp(db.env, s.strikeId)

			await honestVote(s.dropped)
			await honestVote(s.dropped)
			await recalculateScore(db.env, s.dropped)

			expect(await confidence(s.dropped)).toBe("medium")
			expect(await kinds(s.submitter, s.dropped)).toEqual(["first-for-song", "reached-medium"])
		})
	})

	describe("invariants", () => {
		it("a second call revokes nothing and leaves xp_revoked unchanged", async () => {
			const s = await scenario()
			const first = await revokeStrikeXp(db.env, s.strikeId)
			const xpAfterFirst = await getXp(db.env, s.submitter)

			expect(await revokeStrikeXp(db.env, s.strikeId)).toBe(0)
			expect(await xpRevoked(s.strikeId)).toBe(first)
			expect(await getXp(db.env, s.submitter)).toBe(xpAfterFirst)
		})

		it("xp_revoked equals the drop in the submitter's xp", async () => {
			const s = await scenario()
			const before = await getXp(db.env, s.submitter)

			await revokeStrikeXp(db.env, s.strikeId)

			expect(await xpRevoked(s.strikeId)).toBe(before - (await getXp(db.env, s.submitter)))
			expect(await xpRevoked(s.strikeId)).toBeGreaterThan(0)
		})
	})

	describe("edge cases", () => {
		it("returns 0 for an unknown strike id", async () => {
			const { rows } = await db.pool.query<{ id: number }>(
				"SELECT COALESCE(MAX(id), 0) + 1000 AS id FROM vote_strikes"
			)
			expect(await revokeStrikeXp(db.env, rows[0].id)).toBe(0)
		})

		it("revokes nothing when the keys only voted on deleted lyrics", async () => {
			const s = await scenario()
			await db.pool.query(
				`UPDATE lyrics SET deleted_at = $1, deleted_by_user_id = $2, deleted_by_role = 'submitter'
				 WHERE submitter_id = $2 AND id <> $3`,
				[NOW, s.submitter, s.untouched]
			)
			const before = await allEvents()

			expect(await revokeStrikeXp(db.env, s.strikeId)).toBe(0)
			expect(await allEvents()).toEqual(before)
			expect(await xpRevoked(s.strikeId)).toBe(0)
		})

		it("revokes nothing when the keys only voted on other submitters' lyrics", async () => {
			const s = await scenario()
			const other = await seedKey(NOW - 60 * DAY)
			await db.pool.query(
				"UPDATE lyrics SET submitter_id = $1 WHERE submitter_id = $2 AND id <> $3",
				[other, s.submitter, s.untouched]
			)
			await addEvent(db.env, {
				userId: other,
				delta: weights.reachedMedium,
				kind: "reached-medium",
				refType: "lyric",
				refId: s.dropped,
			})
			const before = await allEvents()

			expect(await revokeStrikeXp(db.env, s.strikeId)).toBe(0)
			expect(await allEvents()).toEqual(before)
		})
	})

	describe("error paths", () => {
		it("revokes nothing for an undone strike", async () => {
			const s = await scenario()
			await db.pool.query("UPDATE vote_strikes SET undone_at = $1 WHERE id = $2", [
				NOW + HOUR,
				s.strikeId,
			])
			const before = await allEvents()

			expect(await revokeStrikeXp(db.env, s.strikeId)).toBe(0)
			expect(await allEvents()).toEqual(before)
			expect(await xpRevoked(s.strikeId)).toBe(0)
		})
	})
})

describeIntegration("awardStrikePenaltyXp", () => {
	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("writes one vote-manipulation event per strike", async () => {
		const submitter = await seedKey(T0)
		const { rows: strikes } = await db.pool.query<{ id: number }>(
			`INSERT INTO vote_strikes (submitter_id, kind, key_count, vote_count, repeat, backfill)
			 VALUES ($1, 'serial', 1, 5, true, false) RETURNING id`,
			[submitter]
		)
		const strikeId = strikes[0].id

		expect(await awardStrikePenaltyXp(db.env, submitter, strikeId)).toBe(true)
		expect(await awardStrikePenaltyXp(db.env, submitter, strikeId)).toBe(false)

		const { rows } = await db.pool.query(
			"SELECT user_id, kind, ref_type, ref_id, delta FROM contribution_events"
		)
		expect(rows).toEqual([
			{
				user_id: submitter,
				kind: "vote-manipulation",
				ref_type: "strike",
				ref_id: strikeId,
				delta: config.voteIntegrity.repeatPenalty.xp,
			},
		])
		expect(await getXp(db.env, submitter)).toBe(config.voteIntegrity.repeatPenalty.xp)
	})
})

describeIntegration("revokeConfidenceXp", () => {
	const { weights } = config.gamification.xp
	const confidenceKinds = [
		["reached-medium", weights.reachedMedium],
		["reached-high", weights.reachedHigh],
		["first-for-song", weights.firstForSong],
	] as const

	async function earnedLyric(submitterId: number, now: "low" | "medium" | "high") {
		const id = await lyric(submitterId)
		for (const [kind, delta] of confidenceKinds) {
			await addEvent(db.env, { userId: submitterId, delta, kind, refType: "lyric", refId: id })
		}
		await db.pool.query("UPDATE lyrics SET confidence = $1 WHERE id = $2", [now, id])
		return id
	}

	async function kinds(lyricsId: number): Promise<string[]> {
		const { rows } = await db.pool.query<{ kind: string }>(
			"SELECT kind FROM contribution_events WHERE ref_type = 'lyric' AND ref_id = $1 ORDER BY kind",
			[lyricsId]
		)
		return rows.map((r) => r.kind)
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

	it("high to medium takes back only reached-high", async () => {
		const submitter = await seedKey(T0)
		const id = await earnedLyric(submitter, "medium")

		expect(await revokeConfidenceXp(db.env, submitter, [id])).toBe(weights.reachedHigh)

		expect(await kinds(id)).toEqual(["first-for-song", "reached-medium"])
	})

	it("medium to low takes back reached-medium, first-for-song and reached-high", async () => {
		const submitter = await seedKey(T0)
		const id = await earnedLyric(submitter, "low")

		expect(await revokeConfidenceXp(db.env, submitter, [id])).toBe(
			weights.reachedMedium + weights.reachedHigh + weights.firstForSong
		)

		expect(await kinds(id)).toEqual([])
	})

	it("a lyric still high keeps everything", async () => {
		const submitter = await seedKey(T0)
		const id = await earnedLyric(submitter, "high")

		expect(await revokeConfidenceXp(db.env, submitter, [id])).toBe(0)

		expect(await kinds(id)).toEqual(["first-for-song", "reached-high", "reached-medium"])
	})

	describe("edge cases", () => {
		it("no lyrics revokes nothing", async () => {
			const submitter = await seedKey(T0)
			const id = await earnedLyric(submitter, "low")

			expect(await revokeConfidenceXp(db.env, submitter, [])).toBe(0)

			expect(await kinds(id)).toHaveLength(3)
		})

		it("lyrics not in the list are left alone", async () => {
			const submitter = await seedKey(T0)
			const listed = await earnedLyric(submitter, "low")
			const other = await earnedLyric(submitter, "low")

			await revokeConfidenceXp(db.env, submitter, [listed])

			expect(await kinds(listed)).toEqual([])
			expect(await kinds(other)).toHaveLength(3)
		})
	})

	describe("invariants", () => {
		it("only the given user's confidence events go, and a second call revokes nothing", async () => {
			const submitter = await seedKey(T0)
			const other = await seedKey(T0)
			const id = await earnedLyric(submitter, "low")
			await addEvent(db.env, {
				userId: other,
				delta: weights.reachedMedium,
				kind: "reached-medium",
				refType: "lyric",
				refId: id,
			})
			await awardPenaltyXp(db.env, submitter, id)

			await revokeConfidenceXp(db.env, submitter, [id])

			expect(await kinds(id)).toEqual(["penalized", "reached-medium"])
			expect(await revokeConfidenceXp(db.env, submitter, [id])).toBe(0)
		})
	})
})

describeIntegration("undoStrike", () => {
	const NOW = launchedAt + 10 * DAY

	async function submitterWithLyrics(): Promise<{ id: number; targets: number[] }> {
		const id = await seedKey(T0 - 60 * DAY)
		return { id, targets: await lyrics(id, serialMinVotes) }
	}

	async function strikeAt(targets: number[], at: number) {
		const key = await seedKey(at - HOUR - targets.length * MINUTE)
		for (const [i, target] of targets.entries()) await vote(key, target, at - HOUR + i * MINUTE)
		const [recorded] = await recordStrikes(db.env, await findSuspectKeys(db.env), at)
		return recorded.strikeId
	}

	async function repeats(submitterId: number): Promise<Record<number, boolean>> {
		const { rows } = await db.pool.query<{ id: number; repeat: boolean }>(
			"SELECT id, repeat FROM vote_strikes WHERE submitter_id = $1 ORDER BY id",
			[submitterId]
		)
		return Object.fromEntries(rows.map((r) => [r.id, r.repeat]))
	}

	async function penalized(): Promise<number[]> {
		const { rows } = await db.pool.query<{ ref_id: number }>(
			"SELECT ref_id FROM contribution_events WHERE kind = 'vote-manipulation' ORDER BY ref_id"
		)
		return rows.map((r) => r.ref_id)
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

	it("undoing the first of three strikes makes the second first and keeps the third repeat", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const admin = await seedKey(T0)
		const a = await strikeAt(targets, NOW)
		const b = await strikeAt(targets, NOW + 2 * DAY)
		const c = await strikeAt(targets, NOW + 4 * DAY)
		expect(await repeats(submitter)).toEqual({ [a]: false, [b]: true, [c]: true })
		expect(await penalized()).toEqual([b, c])

		const undone = await undoStrike(db.env, a, admin, NOW + 5 * DAY)

		expect(undone).toMatchObject({ result: "undone", submitterId: submitter, repeatChanged: true })
		expect(await repeats(submitter)).toEqual({ [a]: false, [b]: false, [c]: true })
		expect(await penalized()).toEqual([c])
	})

	it("regression: undoing the only earlier strike clears the later strike's repeat", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const admin = await seedKey(T0)
		const a = await strikeAt(targets, NOW)
		const b = await strikeAt(targets, NOW + 2 * DAY)

		await undoStrike(db.env, a, admin, NOW + 3 * DAY)

		expect(await repeats(submitter)).toEqual({ [a]: false, [b]: false })
		expect(await penalized()).toEqual([])
	})

	it("undoing the last repeat strike changes no other strike", async () => {
		const { id: submitter, targets } = await submitterWithLyrics()
		const admin = await seedKey(T0)
		const a = await strikeAt(targets, NOW)
		const b = await strikeAt(targets, NOW + 2 * DAY)
		const c = await strikeAt(targets, NOW + 4 * DAY)

		const undone = await undoStrike(db.env, c, admin, NOW + 5 * DAY)

		expect(undone).toMatchObject({ result: "undone", repeatChanged: true })
		expect(await repeats(submitter)).toEqual({ [a]: false, [b]: true, [c]: true })
		expect(await penalized()).toEqual([b])
	})

	describe("edge cases", () => {
		it("undoing a lone first strike reports no repeat change", async () => {
			const { targets } = await submitterWithLyrics()
			const admin = await seedKey(T0)
			const a = await strikeAt(targets, NOW)

			expect(await undoStrike(db.env, a, admin, NOW + DAY)).toMatchObject({
				result: "undone",
				repeatChanged: false,
			})
		})

		it("a backfill strike does not keep a later strike repeat once the first live one is undone", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			const admin = await seedKey(T0)
			const backfill = await strikeAt(targets, launchedAt - HOUR)
			const a = await strikeAt(targets, NOW)
			const b = await strikeAt(targets, NOW + 2 * DAY)
			expect(await repeats(submitter)).toEqual({ [backfill]: false, [a]: false, [b]: true })

			await undoStrike(db.env, a, admin, NOW + 3 * DAY)

			expect(await repeats(submitter)).toEqual({ [backfill]: false, [a]: false, [b]: false })
			expect(await penalized()).toEqual([])
		})

		it("another submitter's strikes are untouched", async () => {
			const one = await submitterWithLyrics()
			const two = await submitterWithLyrics()
			const admin = await seedKey(T0)
			const a = await strikeAt(one.targets, NOW)
			await strikeAt(one.targets, NOW + 2 * DAY)
			await strikeAt(two.targets, NOW + 2 * DAY + HOUR)
			await strikeAt(two.targets, NOW + 4 * DAY)
			const twoStrikes = await repeats(two.id)
			expect(Object.values(twoStrikes)).toEqual([false, true])

			await undoStrike(db.env, a, admin, NOW + 5 * DAY)

			expect(await repeats(two.id)).toEqual(twoStrikes)
		})
	})

	describe("invariants", () => {
		it("undo never turns a strike into a repeat", async () => {
			const { id: submitter, targets } = await submitterWithLyrics()
			const admin = await seedKey(T0)
			const a = await strikeAt(targets, NOW)
			const b = await strikeAt(targets, NOW + 2 * DAY)
			const c = await strikeAt(targets, NOW + 4 * DAY)
			let before = await repeats(submitter)

			for (const id of [b, a, c]) {
				await undoStrike(db.env, id, admin, NOW + 5 * DAY)
				const after = await repeats(submitter)
				for (const [strikeId, repeat] of Object.entries(after)) {
					if (repeat) expect(before[Number(strikeId)]).toBe(true)
				}
				before = after
			}
			expect(await penalized()).toEqual([])
		})
	})

	describe("error paths", () => {
		it("an unknown strike is not_found and changes nothing", async () => {
			const admin = await seedKey(T0)
			expect(await undoStrike(db.env, 999999, admin, NOW)).toMatchObject({
				result: "not_found",
				repeatChanged: false,
			})
		})
	})
})
