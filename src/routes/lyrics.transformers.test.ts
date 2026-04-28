import type { LyricsSearchResult } from "@/types"
import { describe, expect, it } from "vitest"
import { type LyricsRowForResponse, toResponse, toSearchResponse } from "./lyrics.transformers"

const baseRow: LyricsRowForResponse = {
	id: 42,
	video_id: "abc123",
	song: "Test Song",
	artist: "Test Artist",
	album: "Test Album",
	isrc: "USRC17607839",
	lyrics: "[00:00.00] Test",
	format: "lrc",
	language: "en",
	sync_type: "linesync",
	score: 5,
	effective_score: 0.75,
	vote_count: 10,
	confidence: "medium",
}

describe("toResponse", () => {
	it("maps base lyrics fields with renaming to camelCase", () => {
		const result = toResponse(baseRow)

		expect(result).toMatchObject({
			id: 42,
			videoId: "abc123",
			song: "Test Song",
			artist: "Test Artist",
			album: "Test Album",
			isrc: "USRC17607839",
			lyrics: "[00:00.00] Test",
			format: "lrc",
			language: "en",
			syncType: "linesync",
			score: 5,
			effectiveScore: 0.75,
			voteCount: 10,
			confidence: "medium",
		})
	})

	it("includes submitter when both keyId and reputation are present", () => {
		const result = toResponse({
			...baseRow,
			submitter_key_id: "deadbeef".repeat(8),
			submitter_reputation: 1.42,
		})

		expect(result.submitter).toEqual({
			keyId: "deadbeef".repeat(8),
			reputation: 1.42,
		})
	})

	it("omits submitter when both fields are absent", () => {
		const result = toResponse(baseRow)
		expect(result.submitter).toBeUndefined()
	})

	it("omits submitter when key_id is null (anonymous lyrics row)", () => {
		const result = toResponse({
			...baseRow,
			submitter_key_id: null,
			submitter_reputation: 1.0,
		})
		expect(result.submitter).toBeUndefined()
	})

	it("omits submitter when reputation is null (legacy row before reputation column)", () => {
		const result = toResponse({
			...baseRow,
			submitter_key_id: "deadbeef".repeat(8),
			submitter_reputation: null,
		})
		expect(result.submitter).toBeUndefined()
	})

	it("preserves reputation of 0 (does not treat as missing)", () => {
		const result = toResponse({
			...baseRow,
			submitter_key_id: "abcdef".repeat(8),
			submitter_reputation: 0,
		})

		expect(result.submitter).toEqual({
			keyId: "abcdef".repeat(8),
			reputation: 0,
		})
	})

	it("converts null album to undefined for clean JSON", () => {
		const result = toResponse({ ...baseRow, album: null })
		expect(result.album).toBeUndefined()
	})

	it("converts null isrc to undefined", () => {
		const result = toResponse({ ...baseRow, isrc: null })
		expect(result.isrc).toBeUndefined()
	})

	it("converts null language to undefined", () => {
		const result = toResponse({ ...baseRow, language: null })
		expect(result.language).toBeUndefined()
	})

	it("converts empty string album to undefined (treats as missing)", () => {
		const result = toResponse({ ...baseRow, album: "" })
		expect(result.album).toBeUndefined()
	})
})

describe("toSearchResponse", () => {
	const baseSearchRow: LyricsSearchResult = {
		id: 7,
		video_id: "vid",
		song: "Song",
		artist: "Artist",
		album: null,
		isrc: null,
		duration: 240,
		format: "ttml",
		language: null,
		sync_type: "richsync",
		score: 3,
		effective_score: 0.5,
		vote_count: 4,
		confidence: "low",
		created_at: 1700000000,
		match_score: 0.85,
		tier: 2,
	}

	it("maps search fields and exposes matchScore", () => {
		const result = toSearchResponse(baseSearchRow)

		expect(result).toEqual({
			id: 7,
			videoId: "vid",
			song: "Song",
			artist: "Artist",
			album: undefined,
			isrc: undefined,
			duration: 240,
			format: "ttml",
			language: undefined,
			syncType: "richsync",
			score: 3,
			effectiveScore: 0.5,
			voteCount: 4,
			confidence: "low",
			matchScore: 0.85,
		})
	})

	it("does not include tier in public response", () => {
		const result = toSearchResponse(baseSearchRow) as Record<string, unknown>
		expect(result.tier).toBeUndefined()
	})

	it("does not leak created_at as snake_case", () => {
		const result = toSearchResponse(baseSearchRow) as Record<string, unknown>
		expect(result.created_at).toBeUndefined()
	})
})
