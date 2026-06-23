import { describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID, isLinkBlacklisted, listBlacklistedKeyIds } from "./blacklist"

describe("link blacklist", () => {
	it("flags the community account", () => {
		expect(isLinkBlacklisted(COMMUNITY_KEY_ID)).toBe(true)
	})

	it("ignores a normal key", () => {
		expect(isLinkBlacklisted("b".repeat(64))).toBe(false)
	})

	describe("edge cases", () => {
		it("matches case-insensitively", () => {
			expect(isLinkBlacklisted(COMMUNITY_KEY_ID.toUpperCase())).toBe(true)
		})

		it("returns false for empty input", () => {
			expect(isLinkBlacklisted("")).toBe(false)
		})

		it("exposes the community key in the listed set", () => {
			expect(listBlacklistedKeyIds()).toContain(COMMUNITY_KEY_ID)
		})
	})
})
