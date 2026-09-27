import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { listOpinions, setOpinion } from "./applicant-opinions"

const APPLICANT = "5a".repeat(32)
const MIRA = "5b".repeat(32)
const OLA = "5c".repeat(32)

describeIntegration("applicant opinions (integration)", () => {
	let db: IntegrationDb
	let mira: number
	let ola: number
	let session: number

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
		mira = await seedCouncilMember(db, MIRA)
		ola = await seedCouncilMember(db, OLA)
		const { rows } = await db.pool.query<{ id: string }>(
			"INSERT INTO exam_session (key_id, seed, expires_at, state) VALUES ($1, 1, 2000000000, 'pending_review') RETURNING id",
			[APPLICANT]
		)
		session = Number(rows[0].id)
	})

	it("records, updates and lists opinions per applicant", async () => {
		expect(await setOpinion(db.env, session, mira, "support", null)).toBe(true)
		expect(
			await setOpinion(db.env, session, ola, "object", "Sealed too eagerly in two scenarios.")
		).toBe(true)
		await setOpinion(db.env, session, mira, "object", "Changed my mind")
		const list = (await listOpinions(db.env, [session])).get(session) ?? []
		expect(list.map((o) => [o.userId, o.stance, o.note])).toEqual(
			expect.arrayContaining([
				[mira, "object", "Changed my mind"],
				[ola, "object", "Sealed too eagerly in two scenarios."],
			])
		)
		expect(list).toHaveLength(2)
	})

	describe("edge cases", () => {
		it("clears an opinion with a null stance", async () => {
			await setOpinion(db.env, session, mira, "support", null)
			await setOpinion(db.env, session, mira, null, null)
			expect((await listOpinions(db.env, [session])).get(session)).toBeUndefined()
		})

		it("clearing an opinion that was never given is a no-op", async () => {
			expect(await setOpinion(db.env, session, mira, null, null)).toBe(true)
		})

		it("returns an empty map for no sessions", async () => {
			expect((await listOpinions(db.env, [])).size).toBe(0)
		})
	})

	describe("error paths", () => {
		it("refuses an unknown applicant", async () => {
			expect(await setOpinion(db.env, 987654321, mira, "support", null)).toBe(false)
		})
	})

	describe("invariants", () => {
		it("drops opinions when the exam session is deleted", async () => {
			await setOpinion(db.env, session, mira, "support", null)
			await db.pool.query("DELETE FROM exam_session WHERE id = $1", [session])
			expect((await listOpinions(db.env, [session])).size).toBe(0)
		})
	})
})
