import { afterEach, describe, expect, it } from "vitest"
import {
	AVATAR_PRESETS,
	addToCatalogue,
	findPreset,
	getPresets,
	setCatalogue,
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
		afterEach(() => setCatalogue([...AVATAR_PRESETS]))

		it("defaults to the seed presets", () => {
			expect(getPresets()).toEqual(AVATAR_PRESETS)
		})

		it("addToCatalogue makes a new preset findable", () => {
			const preset = { id: "new-cat", label: "New Cat", file: "new-cat.webp" }
			addToCatalogue(preset)
			expect(findPreset("new-cat")).toEqual(preset)
			expect(getPresets()).toContainEqual(preset)
		})

		it("setCatalogue replaces the catalogue", () => {
			const only = [{ id: "solo", label: "Solo", file: "solo.webp" }]
			setCatalogue(only)
			expect(getPresets()).toEqual(only)
			expect(findPreset(AVATAR_PRESETS[0].id)).toBeUndefined()
		})
	})
})
