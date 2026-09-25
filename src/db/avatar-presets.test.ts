import { describe, expect, it } from "vitest"
import { AVATAR_PRESETS, findPreset } from "./avatar-presets"

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
})
