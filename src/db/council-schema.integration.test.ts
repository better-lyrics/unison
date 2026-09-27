import { readFileSync } from "node:fs"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest"

const MEMBER_KEY = "c1".repeat(32)

describeIntegration("council dashboard schema (integration)", () => {
	let db: IntegrationDb
	let member: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		member = await seedUser(db, MEMBER_KEY)
	})

	const insertEvent = (kind: string, refId: number | null) =>
		db.pool.query(
			"INSERT INTO council_events (actor_id, kind, source, ref_id) VALUES ($1, $2, 'web', $3)",
			[member, kind, refId]
		)

	it("applies twice without error", async () => {
		await db.pool.query(readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8"))
		const { rows } = await db.pool.query(
			"SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1) ORDER BY table_name",
			[["applicant_opinions", "council_bookmarks", "council_events"]]
		)
		expect(rows.map((r) => r.table_name)).toEqual([
			"applicant_opinions",
			"council_bookmarks",
			"council_events",
		])
	})

	it("defaults new council members to non-admin", async () => {
		await db.pool.query("INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')", [
			member,
		])
		const { rows } = await db.pool.query("SELECT is_admin FROM committee_members WHERE user_id = $1", [
			member,
		])
		expect(rows[0].is_admin).toBe(false)
	})

	it("rejects an unknown event kind, source, bookmark item type and opinion stance", async () => {
		await expect(insertEvent("promote", null)).rejects.toThrow()
		await expect(
			db.pool.query(
				"INSERT INTO council_events (actor_id, kind, source) VALUES ($1, 'seal', 'slack')",
				[member]
			)
		).rejects.toThrow()
		await expect(
			db.pool.query(
				"INSERT INTO council_bookmarks (user_id, item_type, item_id) VALUES ($1, 'song', 1)",
				[member]
			)
		).rejects.toThrow()
		await expect(
			db.pool.query(
				"INSERT INTO applicant_opinions (exam_session_id, user_id, stance) VALUES (1, $1, 'maybe')",
				[member]
			)
		).rejects.toThrow()
	})

	it("allows one decision event per kind and reference", async () => {
		await insertEvent("seal", 41)
		await expect(insertEvent("seal", 41)).rejects.toThrow()
		await insertEvent("unseal", 41)
		await insertEvent("seal", 42)
	})

	it("allows repeated bookmark and membership events for one reference", async () => {
		await insertEvent("bookmark", 7)
		await insertEvent("bookmark", 7)
		await insertEvent("member_add", 7)
		await insertEvent("member_add", 7)
		const { rows } = await db.pool.query("SELECT COUNT(*)::int AS n FROM council_events")
		expect(rows[0].n).toBe(4)
	})

	it("keeps an admin action without an actor", async () => {
		await db.pool.query(
			"INSERT INTO council_events (actor_id, kind, source, ref_id) VALUES (NULL, 'unseal', 'admin', 9)"
		)
		const { rows } = await db.pool.query("SELECT actor_id FROM council_events")
		expect(rows[0].actor_id).toBeNull()
	})

	it("wipeRevisionData clears council rows so users can be deleted", async () => {
		await insertEvent("bookmark", 1)
		await db.pool.query(
			"INSERT INTO council_bookmarks (user_id, item_type, item_id) VALUES ($1, 'seal', 1)",
			[member]
		)
		await wipeRevisionData(db)
		const { rows } = await db.pool.query(
			"SELECT (SELECT COUNT(*) FROM council_events)::int AS e, (SELECT COUNT(*) FROM council_bookmarks)::int AS b"
		)
		expect(rows[0]).toEqual({ e: 0, b: 0 })
	})
})
