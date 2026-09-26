import { readFileSync } from "node:fs"
import { config } from "@/config"
import {
	deletePreset,
	insertPreset,
	listPublishedPresets,
	publishPreset,
	reservePreset,
} from "@/db/avatar-presets"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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
		const rows = await listPublishedPresets(env)
		expect(rows).toEqual([{ id: "el-gato", label: "El Gato", file: "el-gato.webp" }])
	})

	it("returns exists on a duplicate id without overwriting", async () => {
		await insertPreset(env, { id: "dup", label: "First", file: "dup.webp" })
		expect(await insertPreset(env, { id: "dup", label: "Second", file: "dup.webp" })).toBe("exists")
		const rows = await listPublishedPresets(env)
		expect(rows).toEqual([{ id: "dup", label: "First", file: "dup.webp" }])
	})

	it("stores created_by and orders by id", async () => {
		await insertPreset(env, { id: "zebra", label: "Zebra", file: "zebra.webp", createdBy: "k1" })
		await insertPreset(env, { id: "apple", label: "Apple", file: "apple.webp" })
		const rows = await listPublishedPresets(env)
		expect(rows.map((r) => r.id)).toEqual(["apple", "zebra"])
	})

	describe("reservation", () => {
		const SKY = { id: "sky-cat", label: "Sky Cat", file: "sky-cat.webp" }

		it("hides a reserved preset until it is published", async () => {
			expect(await reservePreset(env, SKY)).toBe("reserved")
			expect(await listPublishedPresets(env)).toEqual([])
			await publishPreset(env, SKY.id)
			expect(await listPublishedPresets(env)).toEqual([SKY])
		})

		it("refuses an id that is already published", async () => {
			await insertPreset(env, SKY)
			expect(await reservePreset(env, { ...SKY, label: "Other" })).toBe("exists")
			expect(await listPublishedPresets(env)).toEqual([SKY])
		})

		it("refuses an id with a fresh reservation in flight", async () => {
			await reservePreset(env, SKY)
			expect(await reservePreset(env, SKY)).toBe("exists")
		})

		it("frees the id after the reservation is deleted", async () => {
			await reservePreset(env, SKY)
			await deletePreset(env, SKY.id)
			expect(await reservePreset(env, SKY)).toBe("reserved")
		})

		describe("regressions", () => {
			it("regression: reclaims a stale reservation whose upload never finished", async () => {
				const past = Date.now() - config.avatar.reservationTtlMs - 1000
				await reservePreset(env, { ...SKY, label: "Stuck" }, past)
				expect(await reservePreset(env, SKY)).toBe("reserved")
				await publishPreset(env, SKY.id)
				expect(await listPublishedPresets(env)).toEqual([SKY])
			})

			it("regression: never reclaims a published preset, however old", async () => {
				const past = Date.now() - config.avatar.reservationTtlMs - 1000
				await insertPreset(env, SKY, past)
				expect(await reservePreset(env, { ...SKY, label: "Hijack" })).toBe("exists")
				expect(await listPublishedPresets(env)).toEqual([SKY])
			})
		})
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
