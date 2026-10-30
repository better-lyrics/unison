import { COMMUNITY_KEY_ID, config } from "@/config"
import { type SuspectKey, findSuspectKeys, recordStrikes } from "@/db/vote-strikes"
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

const { freshSec, devotedShare, ring, serialMinVotes, launchedAt, mergeWindowSec } =
	config.voteIntegrity

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
		const key = await seedKey(lastVoteAt - 30 * DAY)
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
