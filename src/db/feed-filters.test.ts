import { describe, expect, it } from "vitest"
import { hasAnyFilter, parseFeedFilters } from "./feed-filters"

describe("parseFeedFilters", () => {
	it("returns empty filters when no params present", () => {
		expect(parseFeedFilters({})).toEqual({})
	})

	it("accepts every documented enum value in one call", () => {
		expect(
			parseFeedFilters({
				sort: "newest",
				sortDir: "asc",
				syncType: "richsync",
				format: "lrc",
				tier: "trusted-plus",
				language: "ja",
			})
		).toEqual({
			sort: "newest",
			sortDir: "asc",
			syncType: "richsync",
			format: "lrc",
			tier: "trusted-plus",
			language: "ja",
		})
	})

	it("preserves sort=default as a valid value (not absent)", () => {
		expect(parseFeedFilters({ sort: "default" })).toEqual({ sort: "default" })
	})

	it("drops unknown sort value silently", () => {
		expect(parseFeedFilters({ sort: "garbage" })).toEqual({})
	})

	it("drops unknown syncType value silently", () => {
		expect(parseFeedFilters({ syncType: "weird" })).toEqual({})
	})

	it("drops unknown format value silently", () => {
		expect(parseFeedFilters({ format: "xml" })).toEqual({})
	})

	it("drops unknown tier value silently", () => {
		expect(parseFeedFilters({ tier: "platinum" })).toEqual({})
	})

	it("falls back to desc for unknown sortDir (not dropped)", () => {
		expect(parseFeedFilters({ sort: "newest", sortDir: "sideways" })).toEqual({
			sort: "newest",
			sortDir: "desc",
		})
	})

	it("passes language through verbatim without enum validation", () => {
		expect(parseFeedFilters({ language: "xx-not-a-real-tag" })).toEqual({
			language: "xx-not-a-real-tag",
		})
	})

	it.each([
		["sort", { sort: "" }],
		["sortDir", { sortDir: "" }],
		["syncType", { syncType: "" }],
		["format", { format: "" }],
		["tier", { tier: "" }],
		["language", { language: "" }],
	])("treats empty string for %s as absent", (_name, input) => {
		expect(parseFeedFilters(input)).toEqual({})
	})

	it("keeps the valid params and drops the invalid ones in a mixed call", () => {
		expect(
			parseFeedFilters({
				sort: "top-rated",
				sortDir: "asc",
				syncType: "not-a-type",
				format: "lrc",
				tier: "platinum",
				language: "en",
			})
		).toEqual({
			sort: "top-rated",
			sortDir: "asc",
			format: "lrc",
			language: "en",
		})
	})

	it("ignores extra unknown keys on the input object", () => {
		const input = {
			sort: "newest",
			extra: "ignored",
			anotherUnknown: "also ignored",
		} as { sort?: string; extra?: string; anotherUnknown?: string }
		expect(parseFeedFilters(input)).toEqual({ sort: "newest" })
	})
})

describe("hasAnyFilter", () => {
	it("returns false for the empty object", () => {
		expect(hasAnyFilter({})).toBe(false)
	})

	it("returns false when sort is the default sentinel", () => {
		expect(hasAnyFilter({ sort: "default" })).toBe(false)
	})

	it("returns false when only sortDir is set (meaningless without sort)", () => {
		expect(hasAnyFilter({ sortDir: "asc" })).toBe(false)
	})

	it.each([["newest"], ["top-rated"], ["most-voted"]] as const)(
		"returns true when sort is non-default value %s",
		(sort) => {
			expect(hasAnyFilter({ sort })).toBe(true)
		}
	)

	it("returns true when only syncType is set", () => {
		expect(hasAnyFilter({ syncType: "richsync" })).toBe(true)
	})

	it("returns true when only format is set", () => {
		expect(hasAnyFilter({ format: "lrc" })).toBe(true)
	})

	it("returns true when only tier is set", () => {
		expect(hasAnyFilter({ tier: "trusted-plus" })).toBe(true)
	})

	it("returns true when only language is set", () => {
		expect(hasAnyFilter({ language: "ja" })).toBe(true)
	})

	it("returns true when sort=default is combined with a concrete filter", () => {
		expect(hasAnyFilter({ sort: "default", syncType: "richsync" })).toBe(true)
	})
})
