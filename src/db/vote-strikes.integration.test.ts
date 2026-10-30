import { COMMUNITY_KEY_ID, config } from "@/config"
import { type SuspectKey, findSuspectKeys } from "@/db/vote-strikes"
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

const { freshSec, devotedShare, ring, serialMinVotes } = config.voteIntegrity

describeIntegration("findSuspectKeys", () => {
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

	const sortByUser = (rows: SuspectKey[]) => [...rows].sort((a, b) => a.userId - b.userId)
	const userIds = (rows: SuspectKey[]) => rows.map((r) => r.userId).sort((a, b) => a - b)
	const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
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
			const belowKey = await seedKey(T0 - 30 * DAY)
			const atKey = await seedKey(T0 - 30 * DAY)
			for (const [i, target] of (await lyrics(below, serialMinVotes - 1)).entries()) {
				await vote(belowKey, target, T0 + i * HOUR)
			}
			for (const [i, target] of (await lyrics(at, serialMinVotes)).entries()) {
				await vote(atKey, target, T0 + i * HOUR)
			}

			expect(await findSuspectKeys(db.env)).toEqual([
				{
					userId: atKey,
					submitterId: at,
					votes: serialMinVotes,
					ring: false,
					serial: true,
					lastVoteAt: T0 + (serialMinVotes - 1) * HOUR,
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
			const voter = await seedKey(T0 - 30 * DAY)
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
			const serialKey = await seedKey(T0 - 30 * DAY)
			for (const [i, target] of bLyrics.entries()) await vote(serialKey, target, T0 + i * HOUR)
			for (const [i, target] of aLyrics.slice(1).entries()) {
				await vote(ringKeys[0], target, T0 + HOUR + i * 60)
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
			const mixed = await seedKey(T0 - 30 * DAY)
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
