import { listCouncilEvents } from "@/db/council-events"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture, swapWords } from "@/test/lyric-fixtures"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { backfillCouncilEvents } from "./backfill-council-events"

const MEMBER = "e1".repeat(32)
const SUBMITTER = "e2".repeat(32)
const APPLICANT = "e3".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")

describeIntegration("backfillCouncilEvents (integration)", () => {
	let db: IntegrationDb
	let member: number
	let submitter: number
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
		await db.pool.query("DELETE FROM exam_session WHERE key_id = $1", [APPLICANT])
		member = await seedUser(db, MEMBER)
		submitter = await seedUser(db, SUBMITTER)
		lyricId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc" })
	})

	const kinds = async () =>
		(await listCouncilEvents(db.env, { includeBookmarks: true, limit: 100 })).events.map((e) => [
			e.kind,
			e.at,
		])

	async function seedHistory() {
		await db.pool.query(
			"INSERT INTO committee_members (user_id, added_by, added_at) VALUES ($1, 'bot', 50)",
			[member]
		)
		await db.pool.query(
			"INSERT INTO boosts (booster_id, lyrics_id, created_at, revoked_at) VALUES ($1, $2, 100, 150)",
			[member, lyricId]
		)
		await db.pool.query(
			"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at, note, revoked_at) VALUES ($1, $2, 200, 'late chorus', 250)",
			[lyricId, member]
		)
		await db.pool.query(
			`INSERT INTO lyric_revisions (lyrics_id, rev_no, author_id, lyrics, format, sync_type, content_hash, status, reviewed_by, reviewed_at, review_note)
			 VALUES ($1, 50, $2, $3, 'lrc', 'linesync', 'bf-a', 'rejected', $4, 300, 'keep the hymn text'),
			        ($1, 51, $2, $3, 'lrc', 'linesync', 'bf-b', 'past', $4, 400, NULL),
			        ($1, 52, $2, $3, 'lrc', 'linesync', 'bf-c', 'past', NULL, NULL, NULL)`,
			[lyricId, submitter, swapWords(LRC, 2), member]
		)
		await db.pool.query(
			"INSERT INTO exam_session (key_id, seed, expires_at, state, decided_at) VALUES ($1, 1, 2000000000, 'approved', 500)",
			[APPLICANT]
		)
	}

	it("backfills every decision kind with its original time", async () => {
		await seedHistory()
		const inserted = await backfillCouncilEvents(db.env)
		expect(inserted).toBeGreaterThan(0)
		expect(await kinds()).toEqual([
			["applicant_approve", 500],
			["edit_approve", 400],
			["edit_reject", 300],
			["unreject", 250],
			["reject", 200],
			["unseal", 150],
			["seal", 100],
			["member_add", 50],
		])
	})

	it("keeps notes, actors and marks old decisions as Discord", async () => {
		await seedHistory()
		await backfillCouncilEvents(db.env)
		const { events } = await listCouncilEvents(db.env, { includeBookmarks: false, limit: 100 })
		const reject = events.find((e) => e.kind === "reject")
		expect(reject).toMatchObject({ note: "late chorus", source: "discord", undone: true })
		expect(reject?.actor?.userId).toBe(member)
		expect(events.find((e) => e.kind === "unreject")?.actor).toBeNull()
		expect(events.find((e) => e.kind === "member_add")?.subject?.userId).toBe(member)
	})

	describe("invariants", () => {
		it("is idempotent", async () => {
			await seedHistory()
			await backfillCouncilEvents(db.env)
			const before = await kinds()
			expect(await backfillCouncilEvents(db.env)).toBe(0)
			expect(await kinds()).toEqual(before)
		})

		it("uses no event ids on a run that finds nothing new", async () => {
			await seedHistory()
			await backfillCouncilEvents(db.env)
			const lastId = async () =>
				Number(
					(await db.pool.query("SELECT last_value FROM council_events_id_seq")).rows[0].last_value
				)
			const before = await lastId()
			await backfillCouncilEvents(db.env)
			expect(await lastId()).toBe(before)
		})

		it("skips a revision that went live without a reviewer", async () => {
			await seedHistory()
			await backfillCouncilEvents(db.env)
			expect((await kinds()).filter(([k]) => k === "edit_approve")).toHaveLength(1)
		})

		it("does nothing on an empty history", async () => {
			expect(await backfillCouncilEvents(db.env)).toBe(0)
			expect(await kinds()).toEqual([])
		})
	})
})
