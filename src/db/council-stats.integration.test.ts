import { config } from "@/config"
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { recordCouncilEvent } from "./council-events"
import { getCouncilOverview, getCouncilRoster } from "./council-stats"

const DAY = 86400
const HOUR = 3600
const NOW = Date.UTC(2026, 8, 28, 12) / 1000
const TODAY = Math.floor(NOW / DAY) * DAY
const MIRA = "71".repeat(32)
const OLA = "72".repeat(32)
const SUBMITTER = "73".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")

describeIntegration("council overview stats (integration)", () => {
	let db: IntegrationDb
	let mira: number
	let ola: number
	let lyricId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		mira = await seedCouncilMember(db, MIRA)
		ola = await seedCouncilMember(db, OLA)
		const submitter = await seedUser(db, SUBMITTER)
		lyricId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc" })
		await db.pool.query("UPDATE lyrics SET created_at = $1 WHERE id = $2", [
			NOW - 20 * DAY,
			lyricId,
		])
	})

	let ref = 0
	const decide = (
		actorId: number,
		kind: "seal" | "reject" | "edit_approve" | "edit_reject",
		at: number,
		source: "web" | "discord" = "web"
	) => recordCouncilEvent(db.env.DB, { actorId, kind, source, lyricsId: lyricId, refId: ++ref, at })

	const overview = (scope: "council" | "me" = "council") =>
		getCouncilOverview(db.env, { meId: mira, scope, now: NOW })

	describe("happy paths", () => {
		it("buckets the last 30 UTC days oldest first", async () => {
			await decide(mira, "seal", TODAY + HOUR)
			await decide(ola, "reject", TODAY + 2 * HOUR)
			await decide(ola, "edit_approve", TODAY - DAY + HOUR)
			await decide(ola, "edit_reject", TODAY - DAY + 2 * HOUR)
			const { decisionsByDay } = await overview()
			expect(decisionsByDay).toHaveLength(30)
			expect(decisionsByDay[29]).toEqual({ day: TODAY, sealed: 1, rejected: 1, editsReviewed: 0 })
			expect(decisionsByDay[28]).toEqual({
				day: TODAY - DAY,
				sealed: 0,
				rejected: 0,
				editsReviewed: 2,
			})
			expect(decisionsByDay[0].day).toBe(TODAY - 29 * DAY)
		})

		it("scopes the daily chart to me on request", async () => {
			await decide(mira, "seal", TODAY + HOUR)
			await decide(ola, "reject", TODAY + HOUR)
			const { decisionsByDay } = await overview("me")
			expect(decisionsByDay[29]).toMatchObject({ sealed: 1, rejected: 0 })
		})

		it("reports the seal rate and my month", async () => {
			await decide(mira, "seal", NOW - HOUR)
			await decide(mira, "reject", NOW - HOUR)
			await decide(ola, "reject", NOW - HOUR)
			await decide(mira, "edit_reject", NOW - HOUR)
			const stats = await overview()
			expect(stats.sealRate).toBeCloseTo(1 / 3, 5)
			expect(stats.me).toMatchObject({
				rejectsThisMonth: 1,
				editsThisMonth: 1,
				bookmarkCap: config.council.bookmarkCap,
			})
			expect(stats.me.quota.quota).toBeGreaterThan(0)
		})

		it("measures median hours to decision now and in the previous window", async () => {
			await decide(mira, "reject", NOW - 20 * DAY + 10 * HOUR)
			await decide(mira, "reject", NOW - 20 * DAY + 30 * HOUR)
			await decide(ola, "reject", NOW - 20 * DAY + 20 * HOUR)
			const stats = await overview()
			expect(stats.medianDecisionHours.current).toBeCloseTo(20, 5)
			expect(stats.medianDecisionHours.previous).toBeNull()
			expect(stats.me.medianDecisionHours).toBeCloseTo(20, 5)
		})

		it("splits recent decisions by where they were made", async () => {
			await decide(mira, "reject", NOW - DAY, "web")
			await decide(mira, "reject", NOW - DAY, "web")
			await decide(ola, "reject", NOW - DAY, "discord")
			await decide(ola, "reject", NOW - 8 * DAY, "discord")
			expect((await overview()).sourceSplit).toEqual({ web: 2, discord: 1 })
		})
	})

	describe("edge cases", () => {
		it("returns zeros and nulls on an empty log", async () => {
			const stats = await overview()
			expect(stats.decisionsByDay.every((d) => d.sealed + d.rejected + d.editsReviewed === 0)).toBe(
				true
			)
			expect(stats.sealRate).toBeNull()
			expect(stats.medianDecisionHours).toEqual({ current: null, previous: null })
			expect(stats.sourceSplit).toEqual({ web: 0, discord: 0 })
			expect(stats.me.medianDecisionHours).toBeNull()
		})

		it("ignores decisions older than 30 days in the daily chart", async () => {
			await decide(mira, "reject", TODAY - 30 * DAY + HOUR)
			const { decisionsByDay } = await overview()
			expect(decisionsByDay.reduce((n, d) => n + d.rejected, 0)).toBe(0)
		})
	})

	describe("invariants", () => {
		it("leaves an undone seal out of every count", async () => {
			const { rows } = await db.pool.query<{ id: number }>(
				"INSERT INTO boosts (booster_id, lyrics_id, created_at, revoked_at) VALUES ($1, $2, $3, $4) RETURNING id",
				[mira, lyricId, NOW - HOUR, NOW - 60]
			)
			await recordCouncilEvent(db.env.DB, {
				actorId: mira,
				kind: "seal",
				source: "web",
				lyricsId: lyricId,
				refId: rows[0].id,
				at: NOW - HOUR,
			})
			await decide(ola, "reject", NOW - HOUR)
			const stats = await overview()
			expect(stats.decisionsByDay[29].sealed).toBe(0)
			expect(stats.sealRate).toBe(0)
		})
	})

	describe("roster", () => {
		const roster = () => getCouncilRoster(db.env, { meId: mira, now: NOW })

		it("lists every member with month counts, quota and activity", async () => {
			await db.pool.query("UPDATE users SET nickname = 'Mira' WHERE id = $1", [mira])
			await db.pool.query("UPDATE committee_members SET is_admin = TRUE WHERE user_id = $1", [ola])
			await decide(mira, "seal", NOW - HOUR)
			await decide(mira, "reject", NOW - 2 * HOUR)
			await decide(mira, "edit_approve", NOW - 3 * HOUR)
			await recordCouncilEvent(db.env.DB, {
				actorId: ola,
				kind: "bookmark",
				source: "web",
				refId: 900,
				at: NOW - 5 * DAY,
			})
			const members = await roster()
			expect(members.map((m) => m.keyId)).toEqual([MIRA, OLA])
			expect(members[0]).toMatchObject({
				displayName: "Mira",
				isYou: true,
				isAdmin: false,
				sealsThisMonth: 1,
				rejectsThisMonth: 1,
				editsThisMonth: 1,
				lastActiveAt: NOW - HOUR,
			})
			expect(members[0].quota.quota).toBeGreaterThan(0)
			expect(members[0].weekly).toHaveLength(8)
			expect(members[0].weekly[7]).toBe(3)
			expect(members[1]).toMatchObject({ isYou: false, isAdmin: true, lastActiveAt: NOW - 5 * DAY })
			expect(members[1].weekly.every((n) => n === 0)).toBe(true)
		})

		it("reports no activity for a quiet member", async () => {
			const members = await roster()
			expect(members.find((m) => m.keyId === OLA)?.lastActiveAt).toBeNull()
		})
	})
})
