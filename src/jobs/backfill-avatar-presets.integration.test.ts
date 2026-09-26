import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { AVATAR_PRESETS, insertPreset, listPresetsFromDb } from "@/db/avatar-presets"
import { D1Compat } from "@/infra/database"
import { backfillAvatarPresets } from "@/jobs/backfill-avatar-presets"
import type { Env } from "@/types"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

describeIntegration("backfill avatar presets (integration)", () => {
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

	it("seeds every built-in preset on an empty table", async () => {
		const { seeded } = await backfillAvatarPresets(env)
		expect(seeded).toBe(AVATAR_PRESETS.length)
		expect((await listPresetsFromDb(env)).length).toBe(AVATAR_PRESETS.length)
	})

	it("is idempotent", async () => {
		await backfillAvatarPresets(env)
		const { seeded } = await backfillAvatarPresets(env)
		expect(seeded).toBe(0)
	})

	it("preserves a preset added out of band", async () => {
		await insertPreset(env, { id: "community-1", label: "Community 1", file: "community-1.webp" })
		await backfillAvatarPresets(env)
		expect((await listPresetsFromDb(env)).some((p) => p.id === "community-1")).toBe(true)
	})
})
