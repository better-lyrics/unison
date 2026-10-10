import { config } from "@/config"
import { getCouncilOverview, getCouncilRoster } from "@/db/council-stats"
import { getMySubmissions } from "@/db/feed"
import { castFlagVote, listOpenFlags, listRecentFlags, openCaseIfQualified } from "@/db/flags"
import { findByVideoId, findVariantsByVideoId, softDeleteLyrics } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { isUniqueViolation } from "@/infra/database"
import { updateScores } from "@/jobs/score-updater"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
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

	const flag = async (target = lyricsId) => {
		await db.pool.query("INSERT INTO report_cases (lyrics_id) VALUES ($1)", [target])
	}

	const voteHide = async (target: number) => {
		await db.pool.query(
			"UPDATE lyrics SET vote_count = 3, downvotes = 3, effective_score = -1 WHERE id = $1",
			[target]
		)
	}

	describe("hiding a flagged lyric", () => {
		describe("happy paths", () => {
			it("serves nothing for a video whose only variant is flagged", async () => {
				await flag()
				expect(await findByVideoId(db.env, VIDEO)).toBeNull()
			})

			it("serves the lyric again once the case is kept", async () => {
				await flag()
				expect(await findByVideoId(db.env, VIDEO)).toBeNull()
				await keepCase(Math.floor(Date.now() / 1000))
				db.cache.store.clear()
				expect((await findByVideoId(db.env, VIDEO))?.id).toBe(lyricsId)
			})

			it("skips the flagged variant and serves the other one", async () => {
				const other = await seedLyric(db, await seedUser(db, kid(2)), {
					lyrics: LRC,
					format: "lrc",
					videoId: VIDEO,
				})
				await flag()
				expect((await findByVideoId(db.env, VIDEO))?.id).toBe(other)
			})
		})

		describe("edge cases", () => {
			it("does not hide a lyric whose case was removed or kept", async () => {
				await db.pool.query(
					"INSERT INTO report_cases (lyrics_id, status, decided_at) VALUES ($1, 'kept', 1), ($1, 'removed', 2)",
					[lyricsId]
				)
				expect((await findByVideoId(db.env, VIDEO))?.id).toBe(lyricsId)
			})

			it("marks a flagged lyric hidden in the submitter's own list like a vote-hidden one", async () => {
				const voteHidden = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "dQw4w9WgXcQ",
				})
				await voteHide(voteHidden)
				await flag()
				const rows = await getMySubmissions(db.env, submitter, 10)
				const hidden = Object.fromEntries(rows.map((r) => [r.id, r.hidden]))
				expect(hidden).toEqual({ [lyricsId]: true, [voteHidden]: true })
			})
		})

		describe("invariants", () => {
			it("does not cost the submitter reputation or XP", async () => {
				await flag()
				await updateScores(db.env)
				const { rows } = await db.pool.query(
					`SELECT l.reputation_penalized, u.reputation,
						(SELECT COUNT(*)::INTEGER FROM contribution_events WHERE user_id = u.id) AS events
					 FROM lyrics l JOIN users u ON u.id = l.submitter_id WHERE l.id = $1`,
					[lyricsId]
				)
				expect(rows[0]).toEqual({ reputation_penalized: false, reputation: 1, events: 0 })
			})

			it("keeps the flagged lyric in the variants list", async () => {
				await flag()
				const variants = await findVariantsByVideoId(db.env, VIDEO, 10)
				expect(variants.map((v) => v.id)).toEqual([lyricsId])
			})
		})
	})

	describe("council votes", () => {
		let members: number[]

		beforeEach(async () => {
			members = []
			for (let i = 0; i < 4; i++) members.push(await seedCouncilMember(db, kid(100 + i)))
		})

		const openCase = async (target = lyricsId): Promise<number> => {
			const { rows } = await db.pool.query<{ id: number }>(
				"INSERT INTO report_cases (lyrics_id) VALUES ($1) RETURNING id",
				[target]
			)
			return rows[0].id
		}

		const caseRow = async (id: number) => {
			const { rows } = await db.pool.query(
				"SELECT status, decided_at FROM report_cases WHERE id = $1",
				[id]
			)
			return rows[0]
		}

		const events = async (id: number) => {
			const { rows } = await db.pool.query(
				"SELECT actor_id, kind, source, lyrics_id, note FROM council_events WHERE ref_id = $1 AND kind LIKE 'flag_%' ORDER BY id",
				[id]
			)
			return rows
		}

		const vote = (id: number, voter: number, remove: boolean, note: string | null = null) =>
			castFlagVote(db.env, id, voter, remove, note, "web")

		describe("happy paths", () => {
			it("keeps the case open below the removal quorum", async () => {
				const id = await openCase()
				expect(await vote(id, members[0], true)).toEqual({
					ok: true,
					status: "open",
					removals: 1,
					keeps: 0,
				})
				expect((await caseRow(id)).status).toBe("open")
			})

			it("removes the lyric at the removal quorum", async () => {
				const id = await openCase()
				for (let i = 0; i < config.council.reportFlags.removals - 1; i++)
					await vote(id, members[i], true)
				const last = await vote(id, members[config.council.reportFlags.removals - 1], true)
				expect(last).toEqual({
					ok: true,
					status: "removed",
					lyricsId,
					removals: config.council.reportFlags.removals,
					keeps: 0,
				})
				expect((await caseRow(id)).status).toBe("removed")
				const { rows } = await db.pool.query(
					"SELECT deleted_at, deleted_by_role, deleted_by_user_id, deletion_reason FROM lyrics WHERE id = $1",
					[lyricsId]
				)
				expect(rows[0]).toEqual({
					deleted_at: expect.any(Number),
					deleted_by_role: "admin",
					deleted_by_user_id: members[config.council.reportFlags.removals - 1],
					deletion_reason: "council flag: removed",
				})
			})

			it("closes the case as kept on one keep and serves the lyric again", async () => {
				const id = await openCase()
				expect(await findByVideoId(db.env, VIDEO)).toBeNull()
				expect(await vote(id, members[0], false)).toEqual({
					ok: true,
					status: "kept",
					lyricsId,
					removals: 0,
					keeps: 1,
				})
				const row = await caseRow(id)
				expect(row.status).toBe("kept")
				expect(row.decided_at).toEqual(expect.any(Number))
				db.cache.store.clear()
				expect((await findByVideoId(db.env, VIDEO))?.id).toBe(lyricsId)
			})

			it("records a council event per vote with the lyric and the case", async () => {
				const id = await openCase()
				await castFlagVote(db.env, id, members[0], true, "spam link", "discord")
				await vote(id, members[1], false, "looks fine")
				expect(await events(id)).toEqual([
					{
						actor_id: members[0],
						kind: "flag_remove",
						source: "discord",
						lyrics_id: lyricsId,
						note: "spam link",
					},
					{
						actor_id: members[1],
						kind: "flag_keep",
						source: "web",
						lyrics_id: lyricsId,
						note: "looks fine",
					},
				])
			})

			it("closes as kept when a member changes a remove to a keep", async () => {
				const id = await openCase()
				await vote(id, members[0], true)
				expect(await vote(id, members[0], false)).toEqual({
					ok: true,
					status: "kept",
					lyricsId,
					removals: 0,
					keeps: 1,
				})
				expect((await events(id)).map((e) => e.kind)).toEqual(["flag_remove", "flag_keep"])
			})
		})

		describe("edge cases", () => {
			it("does not count a repeated remove from the same member twice", async () => {
				const id = await openCase()
				await vote(id, members[0], true)
				expect(await vote(id, members[0], true)).toEqual({
					ok: true,
					status: "open",
					removals: 1,
					keeps: 0,
				})
			})

			it("counts the council stats wait from when the case opened", async () => {
				const now = Math.floor(Date.now() / 1000)
				const id = await openCase()
				await db.pool.query("UPDATE report_cases SET opened_at = $2 WHERE id = $1", [
					id,
					now - 7200,
				])
				await db.pool.query("UPDATE lyrics SET created_at = $2 WHERE id = $1", [
					lyricsId,
					now - 72000,
				])
				await vote(id, members[0], false)
				const overview = await getCouncilOverview(db.env, {
					meId: members[0],
					scope: "me",
					now: now + 60,
				})
				expect(overview.medianDecisionHours.current).toBeCloseTo(2, 1)
			})

			it("does not count flag decisions as edit reviews", async () => {
				const id = await openCase()
				await vote(id, members[0], false)
				const overview = await getCouncilOverview(db.env, { meId: members[0], scope: "me" })
				expect(overview.decisionsByDay.reduce((n, d) => n + d.editsReviewed, 0)).toBe(0)
				expect(overview.me.editsThisMonth).toBe(0)
				const roster = await getCouncilRoster(db.env, { meId: members[0] })
				const me = roster.find((m) => m.isYou)
				expect(me?.lastWeek.edits).toBe(0)
				expect(me?.editsThisMonth).toBe(0)
			})
		})

		describe("regressions", () => {
			it("regression: two last removes at once remove and penalise once", async () => {
				const id = await openCase()
				for (let i = 0; i < config.council.reportFlags.removals - 1; i++)
					await vote(id, members[i], true)
				const before = await db.pool.query("SELECT reputation FROM users WHERE id = $1", [
					submitter,
				])
				const extra = await seedCouncilMember(db, kid(200))
				const results = await Promise.all([
					vote(id, members[config.council.reportFlags.removals - 1], true),
					vote(id, extra, true),
				])
				expect(results.filter((r) => r.ok && r.status === "removed")).toHaveLength(1)
				expect(results.filter((r) => !r.ok && r.reason === "already_decided")).toHaveLength(1)
				const { rows } = await db.pool.query(
					`SELECT u.reputation, l.deleted_by_role, l.deleted_at,
						(SELECT COUNT(*)::INTEGER FROM contribution_events
							WHERE user_id = u.id AND kind = 'penalized') AS penalties
					 FROM lyrics l JOIN users u ON u.id = l.submitter_id WHERE l.id = $1`,
					[lyricsId]
				)
				expect(rows[0].deleted_by_role).toBe("admin")
				expect(rows[0].deleted_at).toEqual(expect.any(Number))
				expect(rows[0].penalties).toBe(1)
				expect(rows[0].reputation).toBeCloseTo(
					before.rows[0].reputation - config.moderation.autoHide.reputationPenalty,
					10
				)
			})
		})

		describe("invariants", () => {
			it("writes no second council event for an unchanged repeat vote", async () => {
				const id = await openCase()
				await vote(id, members[0], true)
				await vote(id, members[0], true)
				expect(await events(id)).toHaveLength(1)
			})

			it("leaves the reports in place when the case closes", async () => {
				await reportBy(10, 3)
				const [{ id }] = await cases()
				await vote(id, members[0], false)
				const { rows } = await db.pool.query(
					"SELECT COUNT(*)::INTEGER AS n FROM reports WHERE lyrics_id = $1",
					[lyricsId]
				)
				expect(rows[0].n).toBe(3)
			})
		})

		describe("error paths", () => {
			it("rejects a vote from someone outside the council", async () => {
				const id = await openCase()
				expect(await vote(id, await seedUser(db, kid(300)), true)).toEqual({
					ok: false,
					reason: "not_committee",
				})
				expect(await events(id)).toEqual([])
			})

			it("rejects a vote on a case that does not exist", async () => {
				expect(await vote(2_000_000_000, members[0], true)).toEqual({
					ok: false,
					reason: "not_found",
				})
			})

			it("rejects a vote on a closed case", async () => {
				const id = await openCase()
				await vote(id, members[0], false)
				expect(await vote(id, members[1], true)).toEqual({ ok: false, reason: "already_decided" })
			})

			it("rejects a vote from the lyric's submitter", async () => {
				await db.pool.query(
					"INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')",
					[submitter]
				)
				const id = await openCase()
				expect(await vote(id, submitter, false)).toEqual({ ok: false, reason: "conflict" })
				expect((await caseRow(id)).status).toBe("open")
			})

			it("rejects a vote from a member who reported the lyric", async () => {
				const id = await openCase()
				await report(members[0], "bad_sync")
				expect(await vote(id, members[0], true)).toEqual({ ok: false, reason: "conflict" })
				expect(await events(id)).toEqual([])
			})
		})

		describe("listing", () => {
			it("lists open cases with qualifying reports and votes", async () => {
				await report(await reporter(10), "spam")
				await report(await reporter(11, { votes: 0 }), "spam")
				await report(await reporter(12), "bad_sync")
				const third = await reporter(13)
				await submitReport(db.env, lyricsId, third, { reason: "offensive", details: "slur" })
				await report(await reporter(14), "wrong_song")
				const [{ id }] = await cases()
				await vote(id, members[0], true)
				await vote(id, members[1], true)
				const flags = await listOpenFlags(db.env)
				expect(flags).toEqual([
					{
						id,
						lyricsId,
						videoId: VIDEO,
						song: "Amazing Grace",
						artist: "Traditional",
						submitterId: submitter,
						openedAt: expect.any(Number),
						reports: [
							{
								reason: "spam",
								details: null,
								reporterId: expect.any(Number),
								createdAt: expect.any(Number),
							},
							{
								reason: "offensive",
								details: "slur",
								reporterId: third,
								createdAt: expect.any(Number),
							},
							{
								reason: "wrong_song",
								details: null,
								reporterId: expect.any(Number),
								createdAt: expect.any(Number),
							},
						],
						removerIds: [members[0], members[1]],
						keeperIds: [],
					},
				])
			})

			it("lists the oldest open case first and leaves closed cases out", async () => {
				const later = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "dQw4w9WgXcQ",
				})
				const closed = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "9bZkp7q19f0",
				})
				const second = await openCase(later)
				const first = await openCase()
				await db.pool.query("UPDATE report_cases SET opened_at = 1000 WHERE id = $1", [first])
				await db.pool.query(
					"INSERT INTO report_cases (lyrics_id, status, decided_at) VALUES ($1, 'kept', 5)",
					[closed]
				)
				expect((await listOpenFlags(db.env)).map((f) => f.id)).toEqual([first, second])
			})

			it("lists recent cases decided at or after the cutoff plus open ones", async () => {
				const kept = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "dQw4w9WgXcQ",
				})
				const old = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "9bZkp7q19f0",
				})
				const open = await openCase()
				const keptCase = await openCase(kept)
				const oldCase = await openCase(old)
				await db.pool.query(
					"UPDATE report_cases SET status = 'kept', decided_at = 5000 WHERE id = $1",
					[keptCase]
				)
				await db.pool.query(
					"UPDATE report_cases SET status = 'removed', decided_at = 4999 WHERE id = $1",
					[oldCase]
				)
				const recent = await listRecentFlags(db.env, 5000)
				expect(recent.map((f) => [f.id, f.status, f.decidedAt])).toEqual(
					[
						[open, "open", null],
						[keptCase, "kept", 5000],
					].sort((a, b) => Number(a[0]) - Number(b[0]))
				)
			})

			it("lists nothing when no case is open", async () => {
				expect(await listOpenFlags(db.env)).toEqual([])
				expect(await listRecentFlags(db.env, 0)).toEqual([])
			})
		})
	})

	describe("deleting a flagged lyric", () => {
		const PENALTY = config.moderation.autoHide.reputationPenalty

		beforeEach(async () => {
			await db.pool.query(
				"UPDATE lyrics SET effective_score = 2, vote_count = 3, upvotes = 3 WHERE id = $1",
				[lyricsId]
			)
		})

		const openCase = async (): Promise<number> => {
			const { rows } = await db.pool.query<{ id: number }>(
				"INSERT INTO report_cases (lyrics_id) VALUES ($1) RETURNING id",
				[lyricsId]
			)
			return Number(rows[0].id)
		}

		const caseRow = async (id: number) => {
			const { rows } = await db.pool.query<{ status: string; decided_at: number | null }>(
				"SELECT status, decided_at FROM report_cases WHERE id = $1",
				[id]
			)
			return rows[0]
		}

		const submitterState = async () => {
			const { rows } = await db.pool.query<{ reputation: number; penalties: number }>(
				`SELECT u.reputation,
					(SELECT COUNT(*)::INTEGER FROM contribution_events
						WHERE user_id = u.id AND kind = 'penalized') AS penalties
				 FROM users u WHERE u.id = $1`,
				[submitter]
			)
			return rows[0]
		}

		describe("happy paths", () => {
			it("penalises a submitter who deletes their flagged lyric once and closes the case", async () => {
				const id = await openCase()
				const before = await submitterState()
				expect(await softDeleteLyrics(db.env, lyricsId, submitter, "submitter")).toEqual({
					deleted: true,
				})
				expect(await caseRow(id)).toEqual({ status: "removed", decided_at: expect.any(Number) })
				const after = await submitterState()
				expect(after.penalties).toBe(1)
				expect(after.reputation).toBeCloseTo(before.reputation - PENALTY, 10)
			})

			it("closes the case as removed on an admin delete", async () => {
				const id = await openCase()
				const admin = await seedUser(db, kid(300))
				await softDeleteLyrics(db.env, lyricsId, admin, "admin", "spam")
				expect(await caseRow(id)).toEqual({ status: "removed", decided_at: expect.any(Number) })
				expect((await submitterState()).penalties).toBe(1)
			})
		})

		describe("edge cases", () => {
			it("does not penalise a submitter deleting an unflagged well scored lyric", async () => {
				const before = await submitterState()
				await softDeleteLyrics(db.env, lyricsId, submitter, "submitter")
				expect(await submitterState()).toEqual(before)
			})

			it("leaves a kept case untouched on delete", async () => {
				const id = await openCase()
				await db.pool.query(
					"UPDATE report_cases SET status = 'kept', decided_at = 1700000000 WHERE id = $1",
					[id]
				)
				await softDeleteLyrics(db.env, lyricsId, submitter, "submitter")
				expect(await caseRow(id)).toEqual({ status: "kept", decided_at: 1700000000 })
				expect((await submitterState()).penalties).toBe(0)
			})
		})

		describe("regressions", () => {
			it("regression: a quorum after a concurrent delete closes the case without a second penalty", async () => {
				const members: number[] = []
				for (let i = 0; i < config.council.reportFlags.removals; i++)
					members.push(await seedCouncilMember(db, kid(400 + i)))
				const id = await openCase()
				for (let i = 0; i < members.length - 1; i++)
					await castFlagVote(db.env, id, members[i], true, null, "web")
				await softDeleteLyrics(db.env, lyricsId, submitter, "submitter")
				await db.pool.query(
					"UPDATE report_cases SET status = 'open', decided_at = NULL WHERE id = $1",
					[id]
				)
				const before = await submitterState()
				const last = await castFlagVote(db.env, id, members[members.length - 1], true, null, "web")
				expect(last).toMatchObject({ ok: true, status: "removed" })
				expect((await caseRow(id)).status).toBe("removed")
				expect(await submitterState()).toEqual(before)
			})
		})

		describe("invariants", () => {
			it("never lists an open case whose lyric is already deleted", async () => {
				await openCase()
				await db.pool.query(
					"UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = submitter_id, deleted_by_role = 'submitter' WHERE id = $1",
					[lyricsId]
				)
				expect(await listOpenFlags(db.env)).toEqual([])
				expect(await listRecentFlags(db.env, 0)).toEqual([])
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
