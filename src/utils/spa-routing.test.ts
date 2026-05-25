import { describe, expect, it } from "vitest"
import { API_PREFIXES, isApiPath } from "./spa-routing"

describe("isApiPath", () => {
	describe("bare namespace paths fall through to the SPA", () => {
		it("returns false for the leaderboard bare path", () => {
			expect(isApiPath("/leaderboard")).toBe(false)
		})

		it("returns false for the leaderboard trailing-slash path", () => {
			expect(isApiPath("/leaderboard/")).toBe(false)
		})

		it("returns false for the users bare path", () => {
			expect(isApiPath("/users")).toBe(false)
		})

		it("returns false for the users trailing-slash path", () => {
			expect(isApiPath("/users/")).toBe(false)
		})

		it("returns false for the auth bare path", () => {
			expect(isApiPath("/auth")).toBe(false)
		})

		it("returns false for the auth trailing-slash path", () => {
			expect(isApiPath("/auth/")).toBe(false)
		})
	})

	describe("real API sub-paths are recognised", () => {
		it("returns true for /leaderboard/songs", () => {
			expect(isApiPath("/leaderboard/songs")).toBe(true)
		})

		it("returns true for /leaderboard/users", () => {
			expect(isApiPath("/leaderboard/users")).toBe(true)
		})

		it("returns true for /leaderboard/users/abc", () => {
			expect(isApiPath("/leaderboard/users/abc")).toBe(true)
		})

		it("returns true for /auth/challenge", () => {
			expect(isApiPath("/auth/challenge")).toBe(true)
		})

		it("returns true for /users/abc/submissions", () => {
			expect(isApiPath("/users/abc/submissions")).toBe(true)
		})
	})

	describe("unknown sub-paths under an API namespace are still API", () => {
		it("returns true for a misspelled leaderboard sub-path", () => {
			expect(isApiPath("/leaderboard/typo")).toBe(true)
		})

		it("returns true for a misspelled auth sub-path", () => {
			expect(isApiPath("/auth/bogus")).toBe(true)
		})
	})

	describe("paths that only share a prefix are not API", () => {
		it("returns false when the prefix has trailing characters but no slash", () => {
			expect(isApiPath("/leaderboardx")).toBe(false)
		})

		it("returns false for unrelated SPA routes", () => {
			expect(isApiPath("/about")).toBe(false)
		})

		it("returns false for the root path", () => {
			expect(isApiPath("/")).toBe(false)
		})

		it("returns false for an empty path", () => {
			expect(isApiPath("")).toBe(false)
		})
	})

	describe("boundary cases hold across all prefixes", () => {
		it("returns false for /lyrics (bare prefix with a real handler)", () => {
			expect(isApiPath("/lyrics")).toBe(false)
		})

		it("returns false for /lyrics/ (trailing slash, nothing after)", () => {
			expect(isApiPath("/lyrics/")).toBe(false)
		})
	})

	it("keeps the leaderboard, users, and auth prefixes registered", () => {
		expect(API_PREFIXES).toContain("/leaderboard")
		expect(API_PREFIXES).toContain("/users")
		expect(API_PREFIXES).toContain("/auth")
	})
})
