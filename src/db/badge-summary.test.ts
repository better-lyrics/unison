import { defaultFeaturedKeys } from "@/db/badge-summary"
import { describe, expect, it } from "vitest"

describe("defaultFeaturedKeys", () => {
	it("showcases the strongest eligible medals in category order", () => {
		const keys = defaultFeaturedKeys([
			{ key: "most-loved", tier: null },
			{ key: "prolific", tier: 2 },
		])
		expect(keys).toEqual(["prolific", "most-loved"])
	})

	it("keeps earned secret badges but excludes tier badges", () => {
		const keys = defaultFeaturedKeys([
			{ key: "prolific", tier: 1 },
			{ key: "lyricist", tier: null },
			{ key: "early-adopter", tier: null },
		])
		expect(keys).toEqual(["prolific", "early-adopter"])
	})

	it("caps the set at the configured slot count", () => {
		const many = [
			"most-loved",
			"sharp-ear",
			"verified-contributor",
			"trailblazer",
			"first-responder",
			"polyglot",
			"prolific",
		]
		const keys = defaultFeaturedKeys(many.map((key) => ({ key, tier: null })))
		expect(keys).toHaveLength(5)
	})

	describe("edge cases", () => {
		it("returns an empty set when there are no awards", () => {
			expect(defaultFeaturedKeys([])).toEqual([])
		})

		it("returns an empty set when every award is tier-only", () => {
			expect(defaultFeaturedKeys([{ key: "lyricist", tier: null }])).toEqual([])
		})
	})

	describe("regressions", () => {
		it("regression: features the community badge for the community account", () => {
			expect(defaultFeaturedKeys([{ key: "community", tier: null }])).toEqual(["community"])
		})
	})
})
