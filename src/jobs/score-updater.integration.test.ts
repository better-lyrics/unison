import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getXp } from "@/db/contribution-events"
import { D1Compat } from "@/infra/database"
import { awardConsensusVotes, recalculateScore, updateScores } from "@/jobs/score-updater"
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

	async function downvote(lyricsId: number, reputation: number, avgVote: number): Promise<void> {
		const voterId = await insertUser(reputation, avgVote)
		await pool.query(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,-1,0)",
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

	describe("auto-hide penalty xp", () => {
		const isPenalized = async (lyricsId: number): Promise<boolean> =>
			(
				await one<{ reputation_penalized: boolean }>(
					"SELECT reputation_penalized FROM lyrics WHERE id = $1",
					[lyricsId]
				)
			).reputation_penalized

		const penaltyEvent = (submitterId: number): Promise<{ ref_type: string; ref_id: number }> =>
			one<{ ref_type: string; ref_id: number }>(
				"SELECT ref_type, ref_id::int AS ref_id FROM contribution_events WHERE user_id = $1 AND kind = 'penalized'",
				[submitterId]
			)

		const penaltyRows = (
			submitterId: number
		): Promise<{ ref_type: string; ref_id: number; delta: number }[]> =>
			pool
				.query(
					"SELECT ref_type, ref_id::int AS ref_id, delta::int AS delta FROM contribution_events WHERE user_id = $1 AND kind = 'penalized' ORDER BY ref_id",
					[submitterId]
				)
				.then((r) => r.rows)

		it("deducts penalized xp once when a submission is auto-hidden", async () => {
			const submitter = await insertUser()
			const lyricId = await insertLyric(submitter, "vidAutoHide")
			await downvote(lyricId, 1.0, 0)
			await downvote(lyricId, 1.0, 0)
			await downvote(lyricId, 1.0, 0)

			await updateScores(env)

			expect(await isPenalized(lyricId)).toBe(true)
			expect(await countEvents(submitter, "penalized")).toBe(1)
			expect(await eventDelta(submitter, "penalized")).toBe(-30)
			const ev = await penaltyEvent(submitter)
			expect(ev.ref_type).toBe("lyric")
			expect(ev.ref_id).toBe(lyricId)
			expect(await getXp(env, submitter)).toBe(-30)

			await updateScores(env)

			expect(await countEvents(submitter, "penalized")).toBe(1)
			expect(await getXp(env, submitter)).toBe(-30)
		})

		it("deducts penalized xp for each newly hidden lyric of one submitter in a single run", async () => {
			const submitter = await insertUser()
			const lyricA = await insertLyric(submitter, "vidAutoHideMultiA")
			await downvote(lyricA, 1.0, 0)
			await downvote(lyricA, 1.0, 0)
			await downvote(lyricA, 1.0, 0)
			const lyricB = await insertLyric(submitter, "vidAutoHideMultiB")
			await downvote(lyricB, 1.0, 0)
			await downvote(lyricB, 1.0, 0)
			await downvote(lyricB, 1.0, 0)

			await updateScores(env)

			expect(await isPenalized(lyricA)).toBe(true)
			expect(await isPenalized(lyricB)).toBe(true)
			expect(await countEvents(submitter, "penalized")).toBe(2)
			const rows = await penaltyRows(submitter)
			expect(rows.map((r) => r.ref_type)).toEqual(["lyric", "lyric"])
			expect(rows.map((r) => r.delta)).toEqual([-30, -30])
			expect(rows.map((r) => r.ref_id)).toEqual([lyricA, lyricB])
			expect(await getXp(env, submitter)).toBe(-60)

			await updateScores(env)

			expect(await countEvents(submitter, "penalized")).toBe(2)
			expect(await getXp(env, submitter)).toBe(-60)
		})

		describe("edge cases", () => {
			it("emits no penalized event for a submitter-less auto-hidden lyric", async () => {
				const lyricId = await insertLyric(null, "vidAutoHideNull")
				await downvote(lyricId, 1.0, 0)
				await downvote(lyricId, 1.0, 0)
				await downvote(lyricId, 1.0, 0)

				await updateScores(env)

				expect(await isPenalized(lyricId)).toBe(false)
				expect(
					await num("SELECT count(*)::int n FROM contribution_events WHERE kind = 'penalized'")
				).toBe(0)
			})
		})
	})

	describe("awardConsensusVotes", () => {
		async function castVote(
			lyricsId: number,
			vote: number,
			isSelfVote: number
		): Promise<{ voterId: number; voteId: number }> {
			const voterId = await insertUser()
			const row = await one<{ id: number }>(
				"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote) VALUES ($1,$2,$3,$4) RETURNING id",
				[lyricsId, voterId, vote, isSelfVote]
			)
			return { voterId, voteId: row.id }
		}

		async function setScore(
			lyricId: number,
			effectiveScore: number,
			voteCount: number
		): Promise<void> {
			await pool.query("UPDATE lyrics SET effective_score = $1, vote_count = $2 WHERE id = $3", [
				effectiveScore,
				voteCount,
				lyricId,
			])
		}

		const consensusCount = (userId: number): Promise<number> =>
			countEvents(userId, "consensus-vote")

		const refIdOf = (userId: number): Promise<number> =>
			num(
				"SELECT ref_id::int n FROM contribution_events WHERE user_id = $1 AND kind = 'consensus-vote'",
				[userId]
			)

		const refTypeOf = (userId: number): Promise<string> =>
			one<{ ref_type: string }>(
				"SELECT ref_type FROM contribution_events WHERE user_id = $1 AND kind = 'consensus-vote'",
				[userId]
			).then((r) => r.ref_type)

		it("credits each agreeing non-self voter on a decisive lyric and nobody else", async () => {
			const submitter = await insertUser()
			const decisive = await insertLyric(submitter, "vidConsensusYes")
			await setScore(decisive, 1.0, 3)

			const agreeA = await castVote(decisive, 1, 0)
			const agreeB = await castVote(decisive, 1, 0)
			const disagree = await castVote(decisive, -1, 0)
			const selfAgree = await castVote(decisive, 1, 1)

			const nonDecisive = await insertLyric(submitter, "vidConsensusNo")
			await setScore(nonDecisive, 0.3, 3)
			const nonDecisiveVoter = await castVote(nonDecisive, 1, 0)

			await awardConsensusVotes(env)

			expect(await consensusCount(agreeA.voterId)).toBe(1)
			expect(await consensusCount(agreeB.voterId)).toBe(1)
			expect(await eventDelta(agreeA.voterId, "consensus-vote")).toBe(2)
			expect(await eventDelta(agreeB.voterId, "consensus-vote")).toBe(2)
			expect(await refIdOf(agreeA.voterId)).toBe(agreeA.voteId)
			expect(await refIdOf(agreeB.voterId)).toBe(agreeB.voteId)
			expect(await refTypeOf(agreeA.voterId)).toBe("vote")
			expect(await getXp(env, agreeA.voterId)).toBe(2)
			expect(await getXp(env, agreeB.voterId)).toBe(2)

			expect(await consensusCount(disagree.voterId)).toBe(0)
			expect(await getXp(env, disagree.voterId)).toBe(0)
			expect(await consensusCount(selfAgree.voterId)).toBe(0)
			expect(await getXp(env, selfAgree.voterId)).toBe(0)
			expect(await consensusCount(nonDecisiveVoter.voterId)).toBe(0)
			expect(await getXp(env, nonDecisiveVoter.voterId)).toBe(0)
		})

		it("is idempotent across repeated runs", async () => {
			const submitter = await insertUser()
			const decisive = await insertLyric(submitter, "vidConsensusIdem")
			await setScore(decisive, 1.0, 3)
			const agree = await castVote(decisive, 1, 0)

			await awardConsensusVotes(env)
			await awardConsensusVotes(env)

			expect(await consensusCount(agree.voterId)).toBe(1)
			expect(await getXp(env, agree.voterId)).toBe(2)
		})

		describe("invariants", () => {
			it("credits a downvote that agrees with a negative consensus", async () => {
				const submitter = await insertUser()
				const decisive = await insertLyric(submitter, "vidConsensusNeg")
				await setScore(decisive, -1.0, 3)
				const agree = await castVote(decisive, -1, 0)
				const disagree = await castVote(decisive, 1, 0)

				await awardConsensusVotes(env)

				expect(await consensusCount(agree.voterId)).toBe(1)
				expect(await getXp(env, agree.voterId)).toBe(2)
				expect(await consensusCount(disagree.voterId)).toBe(0)
			})

			it("skips a lyric below the vote-count threshold even when the score is decisive", async () => {
				const submitter = await insertUser()
				const thin = await insertLyric(submitter, "vidConsensusThin")
				await setScore(thin, 1.0, 2)
				const agree = await castVote(thin, 1, 0)

				await awardConsensusVotes(env)

				expect(await consensusCount(agree.voterId)).toBe(0)
				expect(await getXp(env, agree.voterId)).toBe(0)
			})

			it("skips a lyric whose score sits exactly on the 0.5 threshold", async () => {
				const submitter = await insertUser()
				const boundary = await insertLyric(submitter, "vidConsensusBoundary")
				await setScore(boundary, 0.5, 3)
				const agree = await castVote(boundary, 1, 0)

				await awardConsensusVotes(env)

				expect(await consensusCount(agree.voterId)).toBe(0)
				expect(await getXp(env, agree.voterId)).toBe(0)
			})

			it("regression: a flipped vote keeps its earned consensus xp and is not re-credited", async () => {
				const submitter = await insertUser()
				const decisive = await insertLyric(submitter, "vidConsensusFlip")
				await setScore(decisive, 1.0, 3)
				const agree = await castVote(decisive, 1, 0)

				await awardConsensusVotes(env)

				expect(await consensusCount(agree.voterId)).toBe(1)
				expect(await getXp(env, agree.voterId)).toBe(2)

				await pool.query("UPDATE votes SET vote = -1 WHERE id = $1", [agree.voteId])

				await awardConsensusVotes(env)

				expect(await consensusCount(agree.voterId)).toBe(1)
				expect(await getXp(env, agree.voterId)).toBe(2)
			})
		})
	})

	describe("badge evaluation", () => {
		const badgeTierFor = (userId: number, badgeKey: string): Promise<number | null | undefined> =>
			pool
				.query("SELECT tier FROM badge_awards WHERE user_id = $1 AND badge_key = $2", [
					userId,
					badgeKey,
				])
				.then((r) => (r.rows[0] ? (r.rows[0].tier as number | null) : undefined))

		it("awards verified-contributor to a submitter whose lyric reaches medium and stays idempotent", async () => {
			const submitter = await insertUser()
			const lyricId = await insertLyric(submitter, "vidBadgeMedium")
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)
			await upvote(lyricId, 1.0, 0)

			const result = await updateScores(env)

			expect(await confidenceOf(lyricId)).toBe("medium")
			expect(await badgeTierFor(submitter, "verified-contributor")).toBe(1)

			const entry = result.awarded.find((a) => a.userId === submitter)
			expect(entry).toBeDefined()
			expect(entry?.badges.map((b) => b.key)).toContain("verified-contributor")

			const second = await updateScores(env)
			expect(second.awarded.find((a) => a.userId === submitter)).toBeUndefined()
		})
	})
})
