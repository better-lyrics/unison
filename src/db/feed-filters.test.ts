import { describe, expect, it } from "vitest"
import {
	buildFilterFragments,
	buildOrderByClause,
	hasAnyFilter,
	parseFeedFilters,
} from "./feed-filters"

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

describe("buildFilterFragments", () => {
	it("returns empty arrays for empty filters", () => {
		expect(buildFilterFragments({})).toEqual({ conditions: [], params: [] })
	})

	it("emits sync_type fragment for syncType=richsync", () => {
		expect(buildFilterFragments({ syncType: "richsync" })).toEqual({
			conditions: ["sync_type = ?"],
			params: ["richsync"],
		})
	})

	it("emits sync_type fragment for syncType=linesync", () => {
		expect(buildFilterFragments({ syncType: "linesync" })).toEqual({
			conditions: ["sync_type = ?"],
			params: ["linesync"],
		})
	})

	it("emits sync_type fragment for syncType=plain", () => {
		expect(buildFilterFragments({ syncType: "plain" })).toEqual({
			conditions: ["sync_type = ?"],
			params: ["plain"],
		})
	})

	it("emits format fragment for format=lrc", () => {
		expect(buildFilterFragments({ format: "lrc" })).toEqual({
			conditions: ["format = ?"],
			params: ["lrc"],
		})
	})

	it("emits format fragment for format=ttml", () => {
		expect(buildFilterFragments({ format: "ttml" })).toEqual({
			conditions: ["format = ?"],
			params: ["ttml"],
		})
	})

	it("emits format fragment for format=plain", () => {
		expect(buildFilterFragments({ format: "plain" })).toEqual({
			conditions: ["format = ?"],
			params: ["plain"],
		})
	})

	it("emits trusted-plus tier as a literal IN fragment with no params", () => {
		expect(buildFilterFragments({ tier: "trusted-plus" })).toEqual({
			conditions: ["confidence IN ('medium', 'high')"],
			params: [],
		})
	})

	it("emits top-rated tier as a literal equality fragment with no params", () => {
		expect(buildFilterFragments({ tier: "top-rated" })).toEqual({
			conditions: ["confidence = 'high'"],
			params: [],
		})
	})

	it("emits language fragment for a simple BCP-47 code", () => {
		expect(buildFilterFragments({ language: "ja" })).toEqual({
			conditions: ["language = ?"],
			params: ["ja"],
		})
	})

	it("passes a multi-segment BCP-47 language string through verbatim", () => {
		expect(buildFilterFragments({ language: "zh-Hant" })).toEqual({
			conditions: ["language = ?"],
			params: ["zh-Hant"],
		})
	})

	it("combines all five filters in the stable order: syncType, format, tier, language", () => {
		const out = buildFilterFragments({
			syncType: "richsync",
			format: "lrc",
			tier: "top-rated",
			language: "en",
		})
		expect(out.conditions).toEqual([
			"sync_type = ?",
			"format = ?",
			"confidence = 'high'",
			"language = ?",
		])
		expect(out.params).toEqual(["richsync", "lrc", "en"])
	})

	it("orders syncType + tier=top-rated correctly (tier contributes no param)", () => {
		const out = buildFilterFragments({ syncType: "richsync", tier: "top-rated" })
		expect(out.conditions).toEqual(["sync_type = ?", "confidence = 'high'"])
		expect(out.params).toEqual(["richsync"])
	})

	it("orders format + tier=trusted-plus correctly (tier contributes no param)", () => {
		const out = buildFilterFragments({ format: "lrc", tier: "trusted-plus" })
		expect(out.conditions).toEqual(["format = ?", "confidence IN ('medium', 'high')"])
		expect(out.params).toEqual(["lrc"])
	})

	it("slots the tier fragment between earlier fields and a trailing language", () => {
		const out = buildFilterFragments({ tier: "trusted-plus", language: "ja" })
		expect(out.conditions).toEqual(["confidence IN ('medium', 'high')", "language = ?"])
		expect(out.params).toEqual(["ja"])
	})

	it("does not emit a fragment for sort", () => {
		expect(buildFilterFragments({ sort: "newest" })).toEqual({ conditions: [], params: [] })
	})

	it("does not emit a fragment for sortDir", () => {
		expect(buildFilterFragments({ sortDir: "asc" })).toEqual({ conditions: [], params: [] })
	})

	it("does not emit a fragment when only sort and sortDir are set", () => {
		expect(buildFilterFragments({ sort: "top-rated", sortDir: "asc" })).toEqual({
			conditions: [],
			params: [],
		})
	})

	it("emits no phantom params when tier is the only filter", () => {
		const out = buildFilterFragments({ tier: "trusted-plus" })
		expect(out.params).toHaveLength(0)
		expect(out.conditions).toHaveLength(1)
	})

	it("emits exactly two params when tier is combined with syncType and language", () => {
		const out = buildFilterFragments({
			syncType: "richsync",
			tier: "top-rated",
			language: "ja",
		})
		expect(out.params).toEqual(["richsync", "ja"])
		expect(out.conditions).toHaveLength(3)
	})
})

describe("buildOrderByClause", () => {
	const DEFAULT = "RANKING_EXPR DESC"

	it("returns the default expression verbatim for empty filters", () => {
		expect(buildOrderByClause({}, DEFAULT)).toBe(DEFAULT)
	})

	it("returns the default expression when sort is the default sentinel", () => {
		expect(buildOrderByClause({ sort: "default" }, DEFAULT)).toBe(DEFAULT)
	})

	it("ignores sortDir when sort is the default sentinel", () => {
		expect(buildOrderByClause({ sort: "default", sortDir: "asc" }, DEFAULT)).toBe(DEFAULT)
	})

	it("maps newest desc to created_at DESC, id DESC", () => {
		expect(buildOrderByClause({ sort: "newest", sortDir: "desc" }, DEFAULT)).toBe(
			"created_at DESC, id DESC"
		)
	})

	it("maps newest asc to created_at ASC, id ASC", () => {
		expect(buildOrderByClause({ sort: "newest", sortDir: "asc" }, DEFAULT)).toBe(
			"created_at ASC, id ASC"
		)
	})

	it("maps top-rated desc to effective_score DESC, id DESC", () => {
		expect(buildOrderByClause({ sort: "top-rated", sortDir: "desc" }, DEFAULT)).toBe(
			"effective_score DESC, id DESC"
		)
	})

	it("maps top-rated asc to effective_score ASC, id ASC", () => {
		expect(buildOrderByClause({ sort: "top-rated", sortDir: "asc" }, DEFAULT)).toBe(
			"effective_score ASC, id ASC"
		)
	})

	it("maps most-voted desc to vote_count DESC, id DESC", () => {
		expect(buildOrderByClause({ sort: "most-voted", sortDir: "desc" }, DEFAULT)).toBe(
			"vote_count DESC, id DESC"
		)
	})

	it("maps most-voted asc to vote_count ASC, id ASC", () => {
		expect(buildOrderByClause({ sort: "most-voted", sortDir: "asc" }, DEFAULT)).toBe(
			"vote_count ASC, id ASC"
		)
	})

	it("defaults to desc when sort is set but sortDir is absent", () => {
		expect(buildOrderByClause({ sort: "newest" }, DEFAULT)).toBe("created_at DESC, id DESC")
	})

	it("uses id ASC as the tiebreaker for asc sorts", () => {
		const clause = buildOrderByClause({ sort: "most-voted", sortDir: "asc" }, DEFAULT)
		const parts = clause.split(",").map((s) => s.trim())
		expect(parts[1]).toBe("id ASC")
	})

	it("uses id DESC as the tiebreaker for desc sorts", () => {
		const clause = buildOrderByClause({ sort: "top-rated", sortDir: "desc" }, DEFAULT)
		const parts = clause.split(",").map((s) => s.trim())
		expect(parts[1]).toBe("id DESC")
	})
})
