import { describe, expect, it } from "vitest"
import { BADGES, type BadgeCategory, type BadgeKind, CATALOGUE, TIER_BADGES } from "./definitions"

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

const TIER_KEYS = ["lyricist", "elite", "master", "grandmaster", "legendary"]

describe("tier title definitions", () => {
	it("exposes the five position-tier titles", () => {
		expect(TIER_BADGES.map((b) => b.key)).toEqual(TIER_KEYS)
	})

	it("marks every title as category tier and kind title with no tiers", () => {
		for (const b of TIER_BADGES) {
			expect(b.category).toBe("tier")
			expect(b.kind).toBe("title")
			expect(b.tiers).toBeUndefined()
		}
	})

	it("gives every title a non-empty name and description", () => {
		for (const b of TIER_BADGES) {
			expect(b.name.length).toBeGreaterThan(0)
			expect(b.description.length).toBeGreaterThan(0)
		}
	})

	it("resolves color and mono image URLs on the documented scheme", () => {
		for (const b of TIER_BADGES) {
			expect(b.image.color).toBe(`/badges/${b.key}/image.svg?variant=color`)
			expect(b.image.mono).toBe(`/badges/${b.key}/image.svg?variant=mono`)
		}
	})
})

describe("catalogue", () => {
	it("combines BADGES and TIER_BADGES", () => {
		expect(CATALOGUE).toEqual([...BADGES, ...TIER_BADGES])
	})

	it("holds fourteen entries with unique keys", () => {
		const keys = CATALOGUE.map((b) => b.key)
		expect(keys.length).toBe(14)
		expect(new Set(keys).size).toBe(14)
	})
})
