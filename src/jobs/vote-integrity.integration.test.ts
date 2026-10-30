import { config } from "@/config"
import { getXp } from "@/db/contribution-events"
import { listCouncilEvents } from "@/db/council-events"
import { CURATOR_LEADERBOARD_CACHE_KEY } from "@/db/leaderboard"
import { updateReputations } from "@/db/reputation"
import { lyricsVotedByKeys } from "@/db/vote-strikes"
import { recalculateScore } from "@/jobs/score-updater"
import { runVoteIntegrity, undoVoteStrike } from "@/jobs/vote-integrity"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

const { launchedAt, repeatPenalty } = config.voteIntegrity
const NOW = launchedAt + 10 * DAY

let db: IntegrationDb
let seq = 0

async function seedKey(createdAt: number): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		"INSERT INTO users (key_id, created_at) VALUES ($1, $2) RETURNING id",
		[`vi-${++seq}`, createdAt]
	)
	return rows[0].id
}

async function lyric(submitterId: number): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
			sync_type, submitter_id)
		 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2)
		 RETURNING id`,
		[`dQw4w9Wg${String(++seq).padStart(3, "0")}`, submitterId]
	)
	return rows[0].id
}

const vote = (userId: number, lyricsId: number, at: number) =>
	db.pool.query(
		"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at) VALUES ($1, $2, 1, 0, $3)",
		[lyricsId, userId, at]
	)

async function ringBurst(targets: number[], start: number, size = 6): Promise<number[]> {
	const keys: number[] = []
	for (let i = 0; i < size; i++) {
		const signup = start + i * 8 * MINUTE
		const key = await seedKey(signup)
		await vote(key, targets[i % targets.length], signup + 2 * MINUTE)
		if (i % 2 === 0) await vote(key, targets[(i + 1) % targets.length], signup + 5 * MINUTE)
		keys.push(key)
	}
	return keys
}

async function serialKey(targets: number[], start: number): Promise<number> {
	const key = await seedKey(start - MINUTE)
	for (const [i, target] of targets.entries()) await vote(key, target, start + i * MINUTE)
	return key
}

interface Fixture {
	submitter: number
	targets: number[]
	honest: number[]
	ring: number[]
	serial: number
}

async function voravit(at = NOW): Promise<Fixture> {
	const submitter = await seedKey(at - 120 * DAY)
	const targets: number[] = []
	for (let i = 0; i < 6; i++) targets.push(await lyric(submitter))
	const honest: number[] = []
	for (const [i, target] of targets.entries()) {
		const key = await seedKey(at - 200 * DAY)
		await vote(key, target, at - 40 * DAY + i * DAY)
		honest.push(key)
	}
	const ring = await ringBurst(targets, at - 3 * HOUR)
	const serial = await serialKey(targets, at - 2 * HOUR)
	for (const id of targets) await recalculateScore(db.env, id)
	await updateReputations(db.env)
	return { submitter, targets, honest, ring, serial }
}

async function scores(ids: number[]) {
	const { rows } = await db.pool.query<{
		id: number
		effective_score: number
		vote_count: number
		confidence: string
	}>(
		"SELECT id, effective_score, vote_count, confidence FROM lyrics WHERE id = ANY($1::int[]) ORDER BY id",
		[ids]
	)
	return rows
}

async function discounted(): Promise<number[]> {
	const { rows } = await db.pool.query<{ id: number }>(
		"SELECT id FROM users WHERE votes_discounted_at IS NOT NULL ORDER BY id"
	)
	return rows.map((r) => r.id)
}

async function strikes() {
	const { rows } = await db.pool.query<{
		id: number
		submitter_id: number
		kind: string
		key_count: number
		vote_count: number
		repeat: boolean
		backfill: boolean
		xp_revoked: number
	}>(
		"SELECT id, submitter_id, kind, key_count, vote_count, repeat, backfill, xp_revoked FROM vote_strikes ORDER BY id"
	)
	return rows
}

async function councilEvents() {
	const { rows } = await db.pool.query(
		"SELECT actor_id, kind, source, lyrics_id, ref_id, subject_user_id, note, created_at FROM council_events ORDER BY id"
	)
	return rows
}

async function penaltyEvents(userId: number) {
	const { rows } = await db.pool.query(
		"SELECT delta, ref_type, ref_id FROM contribution_events WHERE user_id = $1 AND kind = 'vote-manipulation'",
		[userId]
	)
	return rows
}

async function reputation(userId: number): Promise<number> {
	const { rows } = await db.pool.query<{ reputation: number }>(
		"SELECT reputation FROM users WHERE id = $1",
		[userId]
	)
	return rows[0].reputation
}

async function reputations() {
	const { rows } = await db.pool.query("SELECT id, reputation FROM users ORDER BY id")
	return rows
}

async function snapshot() {
	const { rows } = await db.pool.query(`
		SELECT
			(SELECT COUNT(*) FROM vote_strikes) AS strikes,
			(SELECT COUNT(*) FROM council_events) AS council_events,
			(SELECT COUNT(*) FROM contribution_events) AS contribution_events,
			(SELECT COALESCE(SUM(xp_revoked), 0) FROM vote_strikes) AS xp_revoked,
			(SELECT COUNT(*) FROM users WHERE votes_discounted_at IS NOT NULL) AS discounted
	`)
	return {
		counts: rows[0],
		reputations: await reputations(),
		lyrics: (
			await db.pool.query(
				"SELECT id, effective_score, vote_count, confidence FROM lyrics ORDER BY id"
			)
		).rows,
	}
}

async function videoIdOf(lyricsId: number): Promise<string> {
	const { rows } = await db.pool.query<{ video_id: string }>(
		"SELECT video_id FROM lyrics WHERE id = $1",
		[lyricsId]
	)
	return rows[0].video_id
}

const softDelete = (lyricsId: number) =>
	db.pool.query(
		`UPDATE lyrics SET deleted_at = $1, deleted_by_user_id = submitter_id, deleted_by_role = 'submitter'
		WHERE id = $2`,
		[NOW, lyricsId]
	)

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

describeIntegration("runVoteIntegrity", () => {
	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("discounts a voravit-shaped ring plus serial key end to end", async () => {
		const f = await voravit()
		const before = await scores(f.targets)
		const xpBefore = await getXp(db.env, f.submitter)
		for (const row of before) {
			expect(row.confidence).toBe("medium")
			expect(row.vote_count).toBeGreaterThanOrEqual(3)
		}
		const videoId = await videoIdOf(f.targets[0])
		db.cache.store.set(`v:${videoId}`, "{}")
		db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")
		db.cache.store.set("feed:global:20", "[]")

		const result = await runVoteIntegrity(db.env, NOW)

		expect(result).toEqual({ strikes: 1, keys: 7 })
		expect(await discounted()).toEqual(sorted([...f.ring, f.serial]))
		const after = await scores(f.targets)
		for (const [i, row] of after.entries()) {
			expect(row.vote_count).toBe(1)
			expect(row.vote_count).toBeLessThan(before[i].vote_count)
			expect(row.confidence).toBe("low")
		}

		const [strike] = await strikes()
		expect(strike).toMatchObject({
			submitter_id: f.submitter,
			kind: "both",
			key_count: 7,
			vote_count: 15,
			repeat: false,
			backfill: false,
		})
		expect(strike.xp_revoked).toBeGreaterThan(0)
		expect(await getXp(db.env, f.submitter)).toBe(xpBefore - strike.xp_revoked)
		expect(await penaltyEvents(f.submitter)).toEqual([])

		expect(await councilEvents()).toEqual([
			{
				actor_id: null,
				kind: "vote_strike",
				source: "system",
				lyrics_id: null,
				ref_id: String(strike.id),
				subject_user_id: f.submitter,
				note: "both: 7 keys, 15 votes",
				created_at: NOW,
			},
		])

		expect(db.cache.store.has(`v:${videoId}`)).toBe(false)
		expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(false)
		expect(db.cache.store.has("feed:global:20")).toBe(false)
	})

	it("a repeat burst 25h later writes the penalty event and lowers reputation", async () => {
		const f = await voravit()
		await runVoteIntegrity(db.env, NOW)
		const repBefore = await reputation(f.submitter)
		const xpBefore = await getXp(db.env, f.submitter)

		await ringBurst(f.targets, NOW + 24 * HOUR - 2 * HOUR)
		const later = NOW + 25 * HOUR
		const result = await runVoteIntegrity(db.env, later)

		expect(result).toEqual({ strikes: 1, keys: 6 })
		const [, second] = await strikes()
		expect(second).toMatchObject({ kind: "ring", key_count: 6, repeat: true, backfill: false })
		expect(await penaltyEvents(f.submitter)).toEqual([
			{ delta: repeatPenalty.xp, ref_type: "strike", ref_id: second.id },
		])
		expect(await getXp(db.env, f.submitter)).toBe(xpBefore + repeatPenalty.xp - second.xp_revoked)
		expect(await reputation(f.submitter)).toBeCloseTo(repBefore - repeatPenalty.reputation, 10)
		const events = await councilEvents()
		expect(events.map((e) => e.note)).toEqual([
			"both: 7 keys, 15 votes",
			"ring: 6 keys, 9 votes (repeat)",
		])
	})

	it("history before launch writes a backfill strike with no penalty", async () => {
		const at = launchedAt - 20 * DAY
		const f = await voravit(at)
		await runVoteIntegrity(db.env, at + HOUR)
		await ringBurst(f.targets, launchedAt - 3 * DAY)
		const repBefore = await reputation(f.submitter)

		const result = await runVoteIntegrity(db.env, launchedAt + DAY)

		expect(result).toEqual({ strikes: 1, keys: 6 })
		const rows = await strikes()
		expect(rows.map((s) => [s.repeat, s.backfill])).toEqual([
			[false, true],
			[false, true],
		])
		expect(await penaltyEvents(f.submitter)).toEqual([])
		expect(await reputation(f.submitter)).toBe(repBefore)
		expect((await councilEvents()).map((e) => e.note)).toEqual([
			"both: 7 keys, 15 votes (history before launch)",
			"ring: 6 keys, 9 votes (history before launch)",
		])
	})

	it("no suspects returns zeros and writes nothing", async () => {
		const submitter = await seedKey(NOW - 120 * DAY)
		const target = await lyric(submitter)
		for (let i = 0; i < 4; i++) {
			const key = await seedKey(NOW - 200 * DAY)
			await vote(key, target, NOW - 40 * DAY + i * DAY)
		}
		await recalculateScore(db.env, target)
		db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")
		const before = await snapshot()

		expect(await runVoteIntegrity(db.env, NOW)).toEqual({ strikes: 0, keys: 0 })

		expect(await snapshot()).toEqual(before)
		expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(true)
	})

	describe("edge cases", () => {
		it("merges keys found within 24h into the same strike without a second council event", async () => {
			const f = await voravit()
			await runVoteIntegrity(db.env, NOW)
			const late = await serialKey(f.targets, NOW + HOUR)

			const result = await runVoteIntegrity(db.env, NOW + 2 * HOUR)

			expect(result).toEqual({ strikes: 1, keys: 1 })
			const rows = await strikes()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ key_count: 8, vote_count: 21, repeat: false })
			expect(await discounted()).toContain(late)
			expect((await councilEvents()).map((e) => e.note)).toEqual(["both: 7 keys, 15 votes"])
			for (const row of await scores(f.targets)) expect(row.vote_count).toBe(1)
		})

		it("skips a deleted lyric and still recalculates the live ones", async () => {
			const f = await voravit()
			await softDelete(f.targets[0])
			const deletedBefore = await scores([f.targets[0]])

			await runVoteIntegrity(db.env, NOW)

			expect(await scores([f.targets[0]])).toEqual(deletedBefore)
			for (const row of await scores(f.targets.slice(1))) expect(row.vote_count).toBe(1)
		})

		it("recalculates lyrics of other submitters the strike keys voted on", async () => {
			const f = await voravit()
			const other = await seedKey(NOW - 120 * DAY)
			const otherLyric = await lyric(other)
			await vote(f.serial, otherLyric, NOW - HOUR)
			await recalculateScore(db.env, otherLyric)
			expect((await scores([otherLyric]))[0].vote_count).toBe(1)

			await runVoteIntegrity(db.env, NOW)

			expect((await scores([otherLyric]))[0].vote_count).toBe(0)
		})
	})

	describe("lyricsVotedByKeys", () => {
		it("returns distinct live lyrics of any submitter", async () => {
			const f = await voravit()
			const other = await seedKey(NOW - 120 * DAY)
			const otherLyric = await lyric(other)
			const gone = await lyric(other)
			await vote(f.serial, otherLyric, NOW - HOUR)
			await vote(f.serial, gone, NOW - HOUR)
			await softDelete(gone)

			expect(sorted(await lyricsVotedByKeys(db.env, [f.serial, ...f.ring]))).toEqual(
				sorted([...f.targets, otherLyric])
			)
		})

		it("returns nothing for no keys", async () => {
			expect(await lyricsVotedByKeys(db.env, [])).toEqual([])
		})
	})

	describe("invariants", () => {
		it("a second run returns zeros and changes nothing", async () => {
			await voravit()
			await runVoteIntegrity(db.env, NOW)
			const before = await snapshot()

			expect(await runVoteIntegrity(db.env, NOW + HOUR)).toEqual({ strikes: 0, keys: 0 })

			expect(await snapshot()).toEqual(before)
		})

		it("reputation equals a fresh full updateReputations", async () => {
			await voravit()
			await runVoteIntegrity(db.env, NOW)
			const after = await reputations()

			await updateReputations(db.env)

			expect(await reputations()).toEqual(after)
		})

		it("honest voters lose consensus credit once the lyrics drop below the vote floor", async () => {
			const f = await voravit()
			const honestBefore = await reputation(f.honest[0])
			expect(honestBefore).toBeGreaterThan(config.reputation.default)

			await runVoteIntegrity(db.env, NOW)

			expect(await reputation(f.honest[0])).toBe(config.reputation.default)
		})
	})

	describe("undoVoteStrike", () => {
		async function preStrike(f: Fixture) {
			return {
				lyrics: await scores(f.targets),
				xp: await getXp(db.env, f.submitter),
				reputations: await reputations(),
			}
		}

		it("restores exactly the pre-strike scores, xp and reputation", async () => {
			const f = await voravit()
			const admin = await seedKey(NOW - 300 * DAY)
			const before = await preStrike(f)
			await runVoteIntegrity(db.env, NOW)
			const [strike] = await strikes()
			const videoId = await videoIdOf(f.targets[0])
			db.cache.store.set(`v:${videoId}`, "{}")
			db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "[]")
			db.cache.store.set("feed:global:20", "[]")

			expect(await undoVoteStrike(db.env, strike.id, admin)).toBe("undone")

			expect(await scores(f.targets)).toEqual(before.lyrics)
			expect(await getXp(db.env, f.submitter)).toBe(before.xp)
			expect(await reputations()).toEqual(before.reputations)
			expect(await discounted()).toEqual([])
			expect(db.cache.store.has(`v:${videoId}`)).toBe(false)
			expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(false)
			expect(db.cache.store.has("feed:global:20")).toBe(false)
		})

		it("marks the strike undone and keeps its keys pointing at it", async () => {
			const f = await voravit()
			const admin = await seedKey(NOW - 300 * DAY)
			await runVoteIntegrity(db.env, NOW)
			const [strike] = await strikes()

			await undoVoteStrike(db.env, strike.id, admin)

			const { rows } = await db.pool.query(
				"SELECT undone_at IS NOT NULL AS undone, undone_by FROM vote_strikes WHERE id = $1",
				[strike.id]
			)
			expect(rows[0]).toEqual({ undone: true, undone_by: admin })
			const { rows: keys } = await db.pool.query<{ id: number }>(
				"SELECT id FROM users WHERE vote_strike_id = $1 ORDER BY id",
				[strike.id]
			)
			expect(keys.map((k) => k.id)).toEqual(sorted([...f.ring, f.serial]))
		})

		it("undoing a repeat strike removes its penalty event and restores reputation", async () => {
			const f = await voravit()
			const admin = await seedKey(NOW - 300 * DAY)
			await runVoteIntegrity(db.env, NOW)
			await ringBurst(f.targets, NOW + 22 * HOUR)
			for (const id of f.targets) await recalculateScore(db.env, id)
			await updateReputations(db.env)
			const before = await preStrike(f)
			await runVoteIntegrity(db.env, NOW + 25 * HOUR)
			const [, second] = await strikes()
			expect(second.repeat).toBe(true)
			expect(await penaltyEvents(f.submitter)).toHaveLength(1)

			expect(await undoVoteStrike(db.env, second.id, admin)).toBe("undone")

			expect(await penaltyEvents(f.submitter)).toEqual([])
			expect(await scores(f.targets)).toEqual(before.lyrics)
			expect(await getXp(db.env, f.submitter)).toBe(before.xp)
			expect(await reputations()).toEqual(before.reputations)
		})

		it("logs a vote_strike_undo event and reads the strike event as undone", async () => {
			const f = await voravit()
			const admin = await seedKey(NOW - 300 * DAY)
			await runVoteIntegrity(db.env, NOW)
			const [strike] = await strikes()
			const listed = async () =>
				(await listCouncilEvents(db.env, { includeBookmarks: false, limit: 10 })).events.map(
					(e) => [e.kind, e.undone]
				)
			expect(await listed()).toEqual([["vote_strike", false]])

			await undoVoteStrike(db.env, strike.id, admin, NOW + HOUR)

			const events = await councilEvents()
			expect(events[1]).toEqual({
				actor_id: admin,
				kind: "vote_strike_undo",
				source: "web",
				lyrics_id: null,
				ref_id: String(strike.id),
				subject_user_id: f.submitter,
				note: null,
				created_at: NOW + HOUR,
			})
			expect(await listed()).toEqual([
				["vote_strike_undo", false],
				["vote_strike", true],
			])
		})

		it("an undone strike does not make the next strike a repeat", async () => {
			const f = await voravit()
			const admin = await seedKey(NOW - 300 * DAY)
			await runVoteIntegrity(db.env, NOW)
			const [first] = await strikes()
			await undoVoteStrike(db.env, first.id, admin)
			const repBefore = await reputation(f.submitter)

			await ringBurst(f.targets, NOW + 22 * HOUR)
			expect(await runVoteIntegrity(db.env, NOW + 25 * HOUR)).toEqual({ strikes: 1, keys: 6 })

			const [, second] = await strikes()
			expect(second.repeat).toBe(false)
			expect(await penaltyEvents(f.submitter)).toEqual([])
			expect(await reputation(f.submitter)).toBe(repBefore)
		})

		describe("regressions", () => {
			it("regression: does not re-strike keys the council cleared", async () => {
				await voravit()
				const admin = await seedKey(NOW - 300 * DAY)
				await runVoteIntegrity(db.env, NOW)
				const [strike] = await strikes()
				await undoVoteStrike(db.env, strike.id, admin)
				const before = await snapshot()

				expect(await runVoteIntegrity(db.env, NOW + 30 * HOUR)).toEqual({ strikes: 0, keys: 0 })

				expect(await snapshot()).toEqual(before)
				expect(await discounted()).toEqual([])
			})
		})

		describe("error paths", () => {
			it("a second undo is already_undone and changes nothing", async () => {
				await voravit()
				const admin = await seedKey(NOW - 300 * DAY)
				await runVoteIntegrity(db.env, NOW)
				const [strike] = await strikes()
				await undoVoteStrike(db.env, strike.id, admin)
				const before = await snapshot()

				expect(await undoVoteStrike(db.env, strike.id, admin)).toBe("already_undone")

				expect(await snapshot()).toEqual(before)
			})

			it("an unknown strike is not_found and changes nothing", async () => {
				await voravit()
				const admin = await seedKey(NOW - 300 * DAY)
				await runVoteIntegrity(db.env, NOW)
				const before = await snapshot()

				expect(await undoVoteStrike(db.env, 999999, admin)).toBe("not_found")

				expect(await snapshot()).toEqual(before)
			})
		})
	})

	describe("error paths", () => {
		it("a submitter whose strike cannot be written does not stop the others", async () => {
			const f = await voravit()
			const second = await voravit()
			await db.pool.query(
				`CREATE OR REPLACE FUNCTION vi_fail() RETURNS trigger AS $$
				BEGIN
					IF NEW.submitter_id = ${f.submitter} THEN RAISE EXCEPTION 'blocked'; END IF;
					RETURN NEW;
				END $$ LANGUAGE plpgsql`
			)
			await db.pool.query(
				"CREATE TRIGGER vi_fail BEFORE INSERT ON vote_strikes FOR EACH ROW EXECUTE FUNCTION vi_fail()"
			)
			try {
				const result = await runVoteIntegrity(db.env, NOW)

				expect(result).toEqual({ strikes: 1, keys: 7 })
				expect((await strikes()).map((s) => s.submitter_id)).toEqual([second.submitter])
				expect(await discounted()).toEqual(sorted([...second.ring, second.serial]))
				for (const row of await scores(f.targets)) expect(row.confidence).toBe("medium")
			} finally {
				await db.pool.query("DROP TRIGGER vi_fail ON vote_strikes")
				await db.pool.query("DROP FUNCTION vi_fail()")
			}
		})
	})
})
