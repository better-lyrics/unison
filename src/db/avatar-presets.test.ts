import type { Env } from "@/types"
import { afterEach, describe, expect, it } from "vitest"
import {
	AVATAR_PRESETS,
	type AvatarPreset,
	findPreset,
	getPresets,
	refreshCatalogue,
} from "./avatar-presets"

describe("avatar presets", () => {
	it("exposes at least one preset with stable id, label and file", () => {
		expect(AVATAR_PRESETS.length).toBeGreaterThan(0)
		for (const p of AVATAR_PRESETS) {
			expect(p.id).toMatch(/^[a-z0-9-]+$/)
			expect(p.label.length).toBeGreaterThan(0)
			expect(p.file.length).toBeGreaterThan(0)
		}
	})

	it("has unique ids", () => {
		const ids = AVATAR_PRESETS.map((p) => p.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	describe("findPreset", () => {
		it("returns a known preset by id", () => {
			const first = AVATAR_PRESETS[0]
			expect(findPreset(first.id)).toEqual(first)
		})
		it("returns undefined for an unknown id", () => {
			expect(findPreset("does-not-exist")).toBeUndefined()
		})
	})

	describe("edge cases", () => {
		it("does not match an empty id", () => {
			expect(findPreset("")).toBeUndefined()
		})
		it("matches ids exactly, not case-insensitively or trimmed", () => {
			const { id } = AVATAR_PRESETS[0]
			expect(findPreset(id.toUpperCase())).toBeUndefined()
			expect(findPreset(` ${id} `)).toBeUndefined()
		})
	})

	describe("invariants", () => {
		it("finds every catalogued preset by its own id", () => {
			for (const p of AVATAR_PRESETS) expect(findPreset(p.id)).toBe(p)
		})
		it("has unique files so no two presets share an image", () => {
			const files = AVATAR_PRESETS.map((p) => p.file)
			expect(new Set(files).size).toBe(files.length)
		})
		it("uses url-safe file names", () => {
			for (const p of AVATAR_PRESETS) expect(p.file).toMatch(/^[a-z0-9-]+\.(webp|png|gif)$/)
		})
	})

	describe("catalogue", () => {
		const SKY_CAT: AvatarPreset = { id: "sky-cat", label: "Sky Cat", file: "sky-cat.webp" }

		function controlledDb() {
			const reads: { resolve: (rows: AvatarPreset[]) => void; reject: (err: Error) => void }[] = []
			const DB = {
				prepare: () => ({
					all: () =>
						new Promise((resolve, reject) => {
							reads.push({ resolve: (rows) => resolve({ results: rows }), reject })
						}),
				}),
			}
			return { env: { DB } as unknown as Env, reads }
		}

		async function refreshWith(rows: AvatarPreset[]): Promise<void> {
			const { env, reads } = controlledDb()
			const done = refreshCatalogue(env)
			reads[0].resolve(rows)
			await done
		}

		afterEach(() => refreshWith([]))

		it("defaults to the built-in presets", () => {
			expect(getPresets()).toEqual(AVATAR_PRESETS)
		})

		it("appends published community presets after the built-ins", async () => {
			await refreshWith([SKY_CAT])
			expect(getPresets()).toEqual([...AVATAR_PRESETS, SKY_CAT])
			expect(findPreset("sky-cat")).toEqual(SKY_CAT)
		})

		describe("regressions", () => {
			it("regression: keeps every built-in when the db has none of them seeded", async () => {
				await refreshWith([])
				expect(getPresets()).toEqual(AVATAR_PRESETS)
				for (const p of AVATAR_PRESETS) expect(findPreset(p.id)).toEqual(p)
			})

			it("regression: an older refresh that resolves last does not drop a newer preset", async () => {
				const { env, reads } = controlledDb()
				const older = refreshCatalogue(env)
				const newer = refreshCatalogue(env)
				reads[1].resolve([SKY_CAT])
				await newer
				reads[0].resolve([])
				await older
				expect(findPreset("sky-cat")).toEqual(SKY_CAT)
			})
		})

		describe("invariants", () => {
			it("never duplicates a built-in id that is also in the db", async () => {
				await refreshWith([...AVATAR_PRESETS, SKY_CAT])
				const ids = getPresets().map((p) => p.id)
				expect(new Set(ids).size).toBe(ids.length)
				expect(ids).toHaveLength(AVATAR_PRESETS.length + 1)
			})
		})

		describe("error paths", () => {
			it("keeps the current catalogue when the db read fails", async () => {
				await refreshWith([SKY_CAT])
				const { env, reads } = controlledDb()
				const failing = refreshCatalogue(env)
				reads[0].reject(new Error("db down"))
				await expect(failing).rejects.toThrow("db down")
				expect(findPreset("sky-cat")).toEqual(SKY_CAT)
			})
		})
	})
})
