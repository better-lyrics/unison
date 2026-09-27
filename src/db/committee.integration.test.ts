import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import { wipeCouncilTables } from "@/test/integration-harness"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	addCommittee,
	isCommittee,
	isCouncilAdmin,
	listCommittee,
	listCommitteeKeyIds,
	removeCommittee,
	setCouncilAdmin,
} from "./committee"
import { listCouncilEvents } from "./council-events"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("committee roster (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	async function insertUser(keyId: string): Promise<number> {
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool) } as unknown as Env
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
		await wipeCouncilTables(pool)
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	beforeEach(wipe)

	it("adds a member, then reports membership and lists the roster row", async () => {
		const userId = await insertUser("a".repeat(64))
		await addCommittee(env, userId, { actorId: null, source: "admin" })

		expect(await isCommittee(env, userId)).toBe(true)

		const roster = await listCommittee(env)
		expect(roster).toHaveLength(1)
		expect(roster[0].userId).toBe(userId)
		expect(roster[0].addedBy).toBe("admin")
		expect(typeof roster[0].addedAt).toBe("number")
	})

	it("lists the roster keyIds by joining to users", async () => {
		const keyA = "a".repeat(64)
		const keyB = "b".repeat(64)
		await addCommittee(env, await insertUser(keyA), { actorId: null, source: "admin" })
		await addCommittee(env, await insertUser(keyB), { actorId: null, source: "discord" })

		const keyIds = await listCommitteeKeyIds(env)
		expect(keyIds).toHaveLength(2)
		expect(new Set(keyIds)).toEqual(new Set([keyA, keyB]))
	})

	it("removes a member, leaving membership false and the roster empty", async () => {
		const userId = await insertUser("b".repeat(64))
		await addCommittee(env, userId, { actorId: null, source: "admin" })
		await removeCommittee(env, userId, { actorId: null, source: "admin" })

		expect(await isCommittee(env, userId)).toBe(false)
		expect(await listCommittee(env)).toHaveLength(0)
	})

	describe("edge cases", () => {
		it("reports false for a user id that was never added", async () => {
			const userId = await insertUser("c".repeat(64))
			expect(await isCommittee(env, userId)).toBe(false)
		})
	})

	describe("invariants", () => {
		it("is idempotent: adding the same user twice keeps exactly one roster row", async () => {
			const userId = await insertUser("d".repeat(64))
			await addCommittee(env, userId, { actorId: null, source: "admin" })
			await addCommittee(env, userId, { actorId: null, source: "discord" })

			const roster = await listCommittee(env)
			expect(roster).toHaveLength(1)
			expect(roster[0].userId).toBe(userId)
			expect(roster[0].addedBy).toBe("admin")
		})
	})

	describe("council log", () => {
		const log = async () =>
			(await listCouncilEvents(env, { includeBookmarks: false, limit: 20 })).events

		it("logs an add with its actor and subject, once", async () => {
			const admin = await insertUser("e".repeat(64))
			const member = await insertUser("f".repeat(64))
			await addCommittee(env, member, { actorId: admin, source: "web" })
			await addCommittee(env, member, { actorId: admin, source: "web" })
			const events = await log()
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ kind: "member_add", source: "web" })
			expect(events[0].actor?.userId).toBe(admin)
			expect(events[0].subject?.userId).toBe(member)
		})

		it("logs a removal only when a member was removed", async () => {
			const member = await insertUser("f".repeat(64))
			await removeCommittee(env, member, { actorId: null, source: "admin" })
			expect(await log()).toEqual([])
			await addCommittee(env, member, { actorId: null, source: "discord" })
			await removeCommittee(env, member, { actorId: null, source: "discord" })
			expect((await log()).map((e) => e.kind)).toEqual(["member_remove", "member_add"])
		})

		it("records the legacy added_by label from the source", async () => {
			await addCommittee(env, await insertUser("c1".repeat(32)), {
				actorId: null,
				source: "discord",
			})
			await addCommittee(env, await insertUser("c2".repeat(32)), { actorId: null, source: "web" })
			expect((await listCommittee(env)).map((r) => r.addedBy).sort()).toEqual(["bot", "web"])
		})
	})

	describe("council admins", () => {
		it("defaults to non-admin and toggles on and off", async () => {
			const member = await insertUser("c9".repeat(32))
			await addCommittee(env, member, { actorId: null, source: "admin" })
			expect(await isCouncilAdmin(env, member)).toBe(false)
			expect(await setCouncilAdmin(env, member, true)).toBe(true)
			expect(await isCouncilAdmin(env, member)).toBe(true)
			expect((await listCommittee(env))[0].isAdmin).toBe(true)
			await setCouncilAdmin(env, member, false)
			expect(await isCouncilAdmin(env, member)).toBe(false)
		})

		it("refuses to flag someone outside the council", async () => {
			const outsider = await insertUser("c8".repeat(32))
			expect(await setCouncilAdmin(env, outsider, true)).toBe(false)
			expect(await isCouncilAdmin(env, outsider)).toBe(false)
		})

		it("drops the admin flag when the member leaves", async () => {
			const member = await insertUser("c7".repeat(32))
			await addCommittee(env, member, { actorId: null, source: "admin" })
			await setCouncilAdmin(env, member, true)
			await removeCommittee(env, member, { actorId: null, source: "admin" })
			await addCommittee(env, member, { actorId: null, source: "admin" })
			expect(await isCouncilAdmin(env, member)).toBe(false)
		})
	})
})
