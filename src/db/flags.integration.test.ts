import { openCaseIfQualified } from "@/db/flags"
import { submitReport } from "@/db/reports"
import { isUniqueViolation } from "@/infra/database"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import type { ReportRequest } from "@/types"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const VIDEO = "LZTOfQiudx0"
const LRC = readRevisionFixture("amazing-grace.lrc")
const kid = (n: number): string => n.toString(16).padStart(64, "0")

describeIntegration("council flags (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	let lyricsId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		submitter = await seedUser(db, kid(1))
		lyricsId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
	})

	const reporter = async (
		n: number,
		opts: { reputation?: number; votes?: number; banned?: boolean } = {}
	): Promise<number> => {
		const id = await seedUser(db, kid(n))
		await db.pool.query(
			"UPDATE users SET reputation = $2, vote_count = $3, banned_at = $4 WHERE id = $1",
			[id, opts.reputation ?? 1.0, opts.votes ?? 5, opts.banned ? 1700000000 : null]
		)
		return id
	}

	const report = (userId: number, reason: ReportRequest["reason"] = "spam", target = lyricsId) =>
		submitReport(db.env, target, userId, { reason })

	const reportBy = async (
		from: number,
		count: number,
		reason: ReportRequest["reason"] = "spam"
	) => {
		for (let i = 0; i < count; i++) await report(await reporter(from + i), reason)
	}

	const cases = async (target = lyricsId) => {
		const { rows } = await db.pool.query<{ id: number; status: string }>(
			"SELECT id, status FROM report_cases WHERE lyrics_id = $1 ORDER BY id",
			[target]
		)
		return rows
	}

	const keepCase = async (decidedAt: number) => {
		await db.pool.query(
			"UPDATE report_cases SET status = 'kept', decided_at = $2 WHERE lyrics_id = $1 AND status = 'open'",
			[lyricsId, decidedAt]
		)
	}

	describe("opening a case", () => {
		describe("happy paths", () => {
			it("opens exactly one case at three qualifying reports", async () => {
				await reportBy(10, 3)
				expect(await cases()).toEqual([{ id: expect.any(Number), status: "open" }])
			})

			it("does not open a case at two qualifying reports", async () => {
				await reportBy(10, 2)
				expect(await cases()).toEqual([])
			})

			it("counts every qualifying reason together", async () => {
				await report(await reporter(10), "spam")
				await report(await reporter(11), "wrong_song")
				await report(await reporter(12), "offensive")
				expect(await cases()).toHaveLength(1)
			})

			it("returns the new case id", async () => {
				for (let i = 0; i < 3; i++) {
					await db.pool.query(
						"INSERT INTO reports (lyrics_id, user_id, reason) VALUES ($1, $2, 'spam')",
						[lyricsId, await reporter(10 + i)]
					)
				}
				const id = await openCaseIfQualified(db.env, lyricsId)
				expect(await cases()).toEqual([{ id, status: "open" }])
			})
		})

		describe("edge cases", () => {
			it("never counts bad_sync or other", async () => {
				await reportBy(10, 3, "bad_sync")
				await reportBy(20, 3, "other")
				expect(await cases()).toEqual([])
			})

			it("does not count a reporter below the reputation floor", async () => {
				await reportBy(10, 2)
				await report(await reporter(20, { reputation: 0.99 }))
				expect(await cases()).toEqual([])
			})

			it("does not count a reporter below the vote floor", async () => {
				await reportBy(10, 2)
				await report(await reporter(20, { votes: 4 }))
				expect(await cases()).toEqual([])
			})

			it("does not count a banned reporter", async () => {
				await reportBy(10, 2)
				await report(await reporter(20, { banned: true }))
				expect(await cases()).toEqual([])
			})

			it("does not open a case for a deleted lyric", async () => {
				for (let i = 0; i < 3; i++) {
					await db.pool.query(
						"INSERT INTO reports (lyrics_id, user_id, reason) VALUES ($1, $2, 'spam')",
						[lyricsId, await reporter(10 + i)]
					)
				}
				await db.pool.query(
					"UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
					[lyricsId, submitter]
				)
				expect(await openCaseIfQualified(db.env, lyricsId)).toBeNull()
				expect(await cases()).toEqual([])
			})

			it("ignores reports made before the last kept decision", async () => {
				await reportBy(10, 3)
				const now = Math.floor(Date.now() / 1000)
				await db.pool.query("UPDATE reports SET created_at = $2 WHERE lyrics_id = $1", [
					lyricsId,
					now - 100,
				])
				await keepCase(now - 50)
				await reportBy(20, 2)
				expect((await cases()).map((c) => c.status)).toEqual(["kept"])
				await report(await reporter(30))
				expect((await cases()).map((c) => c.status)).toEqual(["kept", "open"])
			})
		})

		describe("regressions", () => {
			it("regression: lyric with 7 mixed reports of which 4 qualify opens a case", async () => {
				await report(await reporter(10), "bad_sync")
				await report(await reporter(11), "other")
				await report(await reporter(12, { votes: 0 }), "spam")
				await report(await reporter(13), "wrong_song")
				await report(await reporter(14), "bad_sync")
				await report(await reporter(15), "spam")
				expect(await cases()).toEqual([])
				await report(await reporter(16), "offensive")
				await report(await reporter(17), "spam")
				expect(await cases()).toHaveLength(1)
			})
		})

		describe("invariants", () => {
			it("opens one case when two reports cross the threshold at once", async () => {
				await reportBy(10, 2)
				const [a, b] = [await reporter(20), await reporter(21)]
				await Promise.all([report(a), report(b)])
				expect(await cases()).toHaveLength(1)
			})

			it("does not open a second case while one is open", async () => {
				await reportBy(10, 3)
				await reportBy(20, 3)
				expect(await cases()).toHaveLength(1)
			})

			it("evicts the cached video lookup when a case opens", async () => {
				await reportBy(10, 2)
				db.cache.store.set(`v:${VIDEO}`, "{}")
				await report(await reporter(20))
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			})

			it("keeps the cached video lookup when no case opens", async () => {
				await reportBy(10, 1)
				db.cache.store.set(`v:${VIDEO}`, "{}")
				await report(await reporter(20))
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(true)
			})
		})

		describe("error paths", () => {
			it("returns null for a lyric that does not exist", async () => {
				expect(await openCaseIfQualified(db.env, 2_000_000_000)).toBeNull()
			})

			it("still rejects a duplicate report from the same reporter", async () => {
				const id = await reporter(10)
				await report(id)
				expect(await report(id)).toEqual({ success: false, message: "Already reported" })
			})
		})
	})

	describe("schema", () => {
		it("allows only one open case per lyric", async () => {
			await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			const second = db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			await expect(second).rejects.toSatisfy(isUniqueViolation)
		})

		it("allows a new open case once the previous one is decided", async () => {
			await db.pool.query(
				"INSERT INTO report_cases (lyrics_id, status, decided_at) VALUES ($1, 'kept', 1)",
				[lyricsId]
			)
			await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [lyricsId])
			const { rows } = await db.pool.query(
				"SELECT status FROM report_cases WHERE lyrics_id = $1 ORDER BY id",
				[lyricsId]
			)
			expect(rows.map((r) => r.status)).toEqual(["kept", "open"])
		})

		it("accepts flag council event kinds", async () => {
			await db.pool.query(
				"INSERT INTO council_events (actor_id, kind, source, lyrics_id) VALUES ($1, 'flag_remove', 'web', $2), ($1, 'flag_keep', 'discord', $2)",
				[submitter, lyricsId]
			)
		})
	})
})
