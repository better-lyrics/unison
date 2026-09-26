import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { insertPreset, listPresetsFromDb } from "@/db/avatar-presets"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("avatar presets (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

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

	beforeEach(async () => {
		await pool.query("DELETE FROM avatar_presets")
	})

	it("inserts a preset and lists it back", async () => {
		expect(await insertPreset(env, { id: "el-gato", label: "El Gato", file: "el-gato.webp" })).toBe(
			"inserted"
		)
		const rows = await listPresetsFromDb(env)
		expect(rows).toEqual([{ id: "el-gato", label: "El Gato", file: "el-gato.webp" }])
	})

	it("returns exists on a duplicate id without overwriting", async () => {
		await insertPreset(env, { id: "dup", label: "First", file: "dup.webp" })
		expect(await insertPreset(env, { id: "dup", label: "Second", file: "dup.webp" })).toBe("exists")
		const rows = await listPresetsFromDb(env)
		expect(rows).toEqual([{ id: "dup", label: "First", file: "dup.webp" }])
	})

	it("stores created_by and orders by id", async () => {
		await insertPreset(env, { id: "zebra", label: "Zebra", file: "zebra.webp", createdBy: "k1" })
		await insertPreset(env, { id: "apple", label: "Apple", file: "apple.webp" })
		const rows = await listPresetsFromDb(env)
		expect(rows.map((r) => r.id)).toEqual(["apple", "zebra"])
	})

	describe("invariants", () => {
		it("rejects a second preset that reuses a file name", async () => {
			await insertPreset(env, { id: "a", label: "A", file: "shared.webp" })
			await expect(
				insertPreset(env, { id: "b", label: "B", file: "shared.webp" })
			).rejects.toThrow()
		})
	})
})
