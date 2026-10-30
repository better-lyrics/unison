import { config } from "@/config"
import { softDeleteLyrics } from "@/db/lyrics"
import { updateReputations } from "@/db/reputation"
import { updateScores } from "@/jobs/score-updater"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

describeIntegration("derived reputation (integration)", () => {
	let db: IntegrationDb
	let seq = 0

	const user = (): Promise<number> => seedUser(db, `rep-${++seq}`)

	async function consensusLyric(submitterId: number, score: number): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format,
				sync_type, submitter_id, effective_score, vote_count)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3, 3)
			 RETURNING id`,
			[`REPVID${String(++seq).padStart(5, "0")}`, submitterId, score]
		)
		return rows[0].id
	}

	const vote = (lyricsId: number, userId: number, value: 1 | -1, self = 0) =>
		db.pool.query(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1, $2, $3, $4)",
			[lyricsId, userId, value, self]
		)

	const reputationOf = async (userId: number): Promise<number> =>
		Number(
			(await db.pool.query("SELECT reputation FROM users WHERE id = $1", [userId])).rows[0]
				.reputation
		)

	const penalize = (userId: number, lyricsId: number) =>
		db.pool.query(
			"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, -30, 'penalized', 'lyric', $2)",
			[userId, lyricsId]
		)

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("adds the consensus delta per agreeing vote and subtracts it per disagreeing vote", async () => {
		const submitter = await user()
		const up = await consensusLyric(submitter, 0.9)
		const down = await consensusLyric(submitter, -0.9)
		const voter = await user()
		await vote(up, voter, 1)
		await vote(down, voter, 1)
		const agreer = await user()
		await vote(up, agreer, 1)
		await vote(down, agreer, -1)

		await updateReputations(db.env)

		expect(await reputationOf(voter)).toBeCloseTo(config.reputation.default)
		expect(await reputationOf(agreer)).toBeCloseTo(1.2)
	})

	it("subtracts the penalty for each penalized event", async () => {
		const submitter = await user()
		const a = await consensusLyric(submitter, -0.9)
		const b = await consensusLyric(submitter, -0.9)
		await penalize(submitter, a)
		await penalize(submitter, b)

		await updateReputations(db.env)

		expect(await reputationOf(submitter)).toBeCloseTo(
			config.reputation.default - 2 * config.moderation.autoHide.reputationPenalty
		)
	})

	it("leaves users with no consensus votes and no penalties at the default", async () => {
		const idle = await user()
		await db.pool.query("UPDATE users SET reputation = 1.7 WHERE id = $1", [idle])

		await updateReputations(db.env)

		expect(await reputationOf(idle)).toBeCloseTo(config.reputation.default)
	})

	it("ignores votes on lyrics without consensus", async () => {
		const submitter = await user()
		const weak = await consensusLyric(submitter, 0.4)
		const voter = await user()
		await vote(weak, voter, 1)

		await updateReputations(db.env)

		expect(await reputationOf(voter)).toBeCloseTo(config.reputation.default)
	})

	it("scoped run only touches the given users", async () => {
		const submitter = await user()
		const lyric = await consensusLyric(submitter, 0.9)
		const inScope = await user()
		const outOfScope = await user()
		await vote(lyric, inScope, 1)
		await vote(lyric, outOfScope, 1)

		await updateReputations(db.env, [inScope])

		expect(await reputationOf(inScope)).toBeCloseTo(1.1)
		expect(await reputationOf(outOfScope)).toBeCloseTo(config.reputation.default)
	})

	describe("penalty paths", () => {
		it("an admin removal lowers the derived value, not a stale stored one", async () => {
			const submitter = await user()
			const admin = await user()
			const lyric = await consensusLyric(submitter, -0.9)
			await db.pool.query("UPDATE users SET reputation = 2.0 WHERE id = $1", [submitter])

			await softDeleteLyrics(db.env, lyric, admin, "admin", "copied")

			const expected = config.reputation.default - config.moderation.autoHide.reputationPenalty
			expect(await reputationOf(submitter)).toBeCloseTo(expected)
			await updateReputations(db.env)
			expect(await reputationOf(submitter)).toBeCloseTo(expected)
		})

		it("the auto-hide penalty survives the next score run", async () => {
			const submitter = await user()
			const lyric = await consensusLyric(submitter, -0.9)
			for (let i = 0; i < 3; i++) await vote(lyric, await user(), -1)
			await db.pool.query("UPDATE lyrics SET downvotes = 3 WHERE id = $1", [lyric])

			await updateScores(db.env)
			await updateScores(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(
				config.reputation.default - config.moderation.autoHide.reputationPenalty
			)
		})
	})

	describe("vote strikes", () => {
		const strike = async (
			submitterId: number,
			opts: { repeat: boolean; backfill?: boolean; undone?: boolean }
		) =>
			db.pool.query(
				`INSERT INTO vote_strikes (submitter_id, kind, key_count, vote_count, repeat, backfill, undone_at)
				 VALUES ($1, 'ring', 5, 5, $2, $3, $4)`,
				[submitterId, opts.repeat, opts.backfill ?? false, opts.undone ? 1 : null]
			)

		it("subtracts the repeat penalty for each repeat strike", async () => {
			const submitter = await user()
			await strike(submitter, { repeat: false })
			await strike(submitter, { repeat: true })
			await strike(submitter, { repeat: true })

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(
				config.reputation.default - 2 * config.voteIntegrity.repeatPenalty.reputation
			)
		})

		it("a first strike and a backfill strike cost nothing", async () => {
			const submitter = await user()
			await strike(submitter, { repeat: false, backfill: true })
			await strike(submitter, { repeat: false })

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(config.reputation.default)
		})

		it("an undone repeat strike costs nothing", async () => {
			const submitter = await user()
			await strike(submitter, { repeat: true, undone: true })

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(config.reputation.default)
		})

		it("stacks with penalized events and consensus", async () => {
			const submitter = await user()
			const voter = await user()
			const removed = await consensusLyric(voter, -0.9)
			await vote(await consensusLyric(voter, 0.9), submitter, 1)
			await penalize(submitter, removed)
			await strike(submitter, { repeat: true })

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(
				config.reputation.default +
					config.reputation.consensusDelta -
					config.moderation.autoHide.reputationPenalty -
					config.voteIntegrity.repeatPenalty.reputation
			)
		})
	})

	describe("edge cases", () => {
		it("clamps at the maximum", async () => {
			const submitter = await user()
			const voter = await user()
			for (let i = 0; i < 15; i++) await vote(await consensusLyric(submitter, 0.9), voter, 1)

			await updateReputations(db.env)

			expect(await reputationOf(voter)).toBeCloseTo(config.reputation.max)
		})

		it("clamps at the minimum", async () => {
			const submitter = await user()
			for (let i = 0; i < 6; i++) await penalize(submitter, await consensusLyric(submitter, -0.9))

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(config.reputation.min)
		})

		it("an empty scope touches nobody", async () => {
			const submitter = await user()
			const voter = await user()
			await vote(await consensusLyric(submitter, 0.9), voter, 1)

			await updateReputations(db.env, [])

			expect(await reputationOf(voter)).toBeCloseTo(config.reputation.default)
		})
	})

	describe("error paths", () => {
		it("a scope naming a user that does not exist changes nothing", async () => {
			const submitter = await user()
			const voter = await user()
			await vote(await consensusLyric(submitter, 0.9), voter, 1)

			await updateReputations(db.env, [999_999_999])

			expect(await reputationOf(voter)).toBeCloseTo(config.reputation.default)
		})
	})

	describe("regressions", () => {
		it("regression: does not ratchet across runs", async () => {
			const submitter = await user()
			const voter = await user()
			await vote(await consensusLyric(submitter, 0.9), voter, 1)

			await updateReputations(db.env)
			await updateReputations(db.env)
			await updateReputations(db.env)

			expect(await reputationOf(voter)).toBeCloseTo(1.1)
		})

		it("regression: restores a voter the old ratchet pushed to zero", async () => {
			const submitter = await user()
			const voter = await user()
			await db.pool.query("UPDATE users SET reputation = 0 WHERE id = $1", [voter])
			await vote(await consensusLyric(submitter, 0.9), voter, -1)

			await updateReputations(db.env)

			expect(await reputationOf(voter)).toBeCloseTo(0.9)
		})
	})

	describe("invariants", () => {
		it("excludes self votes", async () => {
			const submitter = await user()
			await vote(await consensusLyric(submitter, 0.9), submitter, 1, 1)

			await updateReputations(db.env)

			expect(await reputationOf(submitter)).toBeCloseTo(config.reputation.default)
		})

		it("does not count votes from banned or discounted voters", async () => {
			const submitter = await user()
			const lyric = await consensusLyric(submitter, 0.9)
			const banned = await user()
			const discounted = await user()
			await vote(lyric, banned, 1)
			await vote(lyric, discounted, 1)
			await db.pool.query("UPDATE users SET banned_at = 1 WHERE id = $1", [banned])
			await db.pool.query("UPDATE users SET votes_discounted_at = 1 WHERE id = $1", [discounted])

			await updateReputations(db.env)

			expect(await reputationOf(banned)).toBeCloseTo(config.reputation.default)
			expect(await reputationOf(discounted)).toBeCloseTo(config.reputation.default)
		})

		it("still counts votes on deleted lyrics", async () => {
			const submitter = await user()
			const lyric = await consensusLyric(submitter, 0.9)
			const voter = await user()
			await vote(lyric, voter, 1)
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
				[lyric, submitter]
			)

			await updateReputations(db.env)

			expect(await reputationOf(voter)).toBeCloseTo(1.1)
		})
	})
})
