import { describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID } from "@/config"
import { isLinkBlacklisted } from "./blacklist"

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
	})
})
