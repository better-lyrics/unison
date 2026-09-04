import { describe, expect, it } from "vitest"
import { BADGES, type BadgeCategory, type BadgeKind } from "./definitions"

const CATEGORIES: BadgeCategory[] = [
	"tier",
	"output",
	"craft",
	"coverage",
	"curation",
	"acclaim",
	"consistency",
	"special",
]

const KINDS: BadgeKind[] = ["title", "medal", "special"]

const LAUNCH_KEYS = [
	"most-loved",
	"sharp-ear",
	"verified-contributor",
	"trailblazer",
	"first-responder",
	"polyglot",
	"committee",
	"first-submission",
	"community",
]

describe("badge definitions", () => {
	it("has unique keys", () => {
		const keys = BADGES.map((b) => b.key)
		expect(new Set(keys).size).toBe(keys.length)
	})

	it("gives every def a non-empty name and description", () => {
		for (const b of BADGES) {
			expect(b.name.length).toBeGreaterThan(0)
			expect(b.description.length).toBeGreaterThan(0)
		}
	})

	it("uses only known categories and kinds", () => {
		for (const b of BADGES) {
			expect(CATEGORIES).toContain(b.category)
			expect(KINDS).toContain(b.kind)
		}
	})

	it("numbers tiers 1..n in order with strictly ascending thresholds", () => {
		for (const b of BADGES) {
			if (!b.tiers) continue
			b.tiers.forEach((tier, i) => {
				expect(tier.level).toBe(i + 1)
			})
			for (let i = 1; i < b.tiers.length; i++) {
				expect(b.tiers[i].threshold).toBeGreaterThan(b.tiers[i - 1].threshold)
			}
		}
	})

	it("resolves image URLs on the documented relative scheme", () => {
		for (const b of BADGES) {
			expect(b.image.color).toBe(`/badges/${b.key}/image.svg?variant=color`)
			expect(b.image.mono).toBe(`/badges/${b.key}/image.svg?variant=mono`)
			expect(b.image.color).toContain(b.key)
			expect(b.image.color).toContain("variant=color")
			expect(b.image.mono).toContain(b.key)
			expect(b.image.mono).toContain("variant=mono")
		}
	})

	it("pins the exact URL for a sample badge", () => {
		const community = BADGES.find((b) => b.key === "community")
		expect(community?.image.color).toBe("/badges/community/image.svg?variant=color")
		expect(community?.image.mono).toBe("/badges/community/image.svg?variant=mono")
	})

	it("includes all nine launch keys", () => {
		const keys = BADGES.map((b) => b.key)
		for (const key of LAUNCH_KEYS) {
			expect(keys).toContain(key)
		}
	})
})
