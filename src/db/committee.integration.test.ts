import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { addCommittee, isCommittee, listCommittee, removeCommittee } from "./committee"

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
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	beforeEach(wipe)

	it("adds a member, then reports membership and lists the roster row", async () => {
		const userId = await insertUser("a".repeat(64))
		await addCommittee(env, userId, "admin")

		expect(await isCommittee(env, userId)).toBe(true)

		const roster = await listCommittee(env)
		expect(roster).toHaveLength(1)
		expect(roster[0].userId).toBe(userId)
		expect(roster[0].addedBy).toBe("admin")
		expect(typeof roster[0].addedAt).toBe("number")
	})

	it("removes a member, leaving membership false and the roster empty", async () => {
		const userId = await insertUser("b".repeat(64))
		await addCommittee(env, userId, "admin")
		await removeCommittee(env, userId)

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
			await addCommittee(env, userId, "admin")
			await addCommittee(env, userId, "someone-else")

			const roster = await listCommittee(env)
			expect(roster).toHaveLength(1)
			expect(roster[0].userId).toBe(userId)
			expect(roster[0].addedBy).toBe("admin")
		})
	})
})
