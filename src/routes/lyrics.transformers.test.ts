import type { LyricsSearchResult } from "@/types"
import { generatePetName } from "@/utils/petname"
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
		const keyId = "deadbeef".repeat(8)
		const result = toResponse({
			...baseRow,
			submitter_key_id: keyId,
			submitter_reputation: 1.42,
			submitter_nickname: "Curator Cat",
		})

		expect(result.submitter).toEqual({
			keyId,
			reputation: 1.42,
			displayName: "Curator Cat",
		})
	})

	it("falls back to generatePetName when submitter_nickname is null", () => {
		const keyId = "abcdef12".repeat(8)
		const result = toResponse({
			...baseRow,
			submitter_key_id: keyId,
			submitter_reputation: 1.0,
			submitter_nickname: null,
		})

		expect(result.submitter).toEqual({
			keyId,
			reputation: 1.0,
			displayName: generatePetName(keyId),
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
		const keyId = "abcdef".repeat(8)
		const result = toResponse({
			...baseRow,
			submitter_key_id: keyId,
			submitter_reputation: 0,
		})

		expect(result.submitter).toEqual({
			keyId,
			reputation: 0,
			displayName: generatePetName(keyId),
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

	it("maps hidden, defaulting to false when the row omits it", () => {
		expect(toResponse(baseRow).hidden).toBe(false)
		expect(toResponse({ ...baseRow, hidden: true }).hidden).toBe(true)
	})
})

describe("toResponse fulfillment badge", () => {
	it("omits fulfilled when no badge provided", () => {
		const res = toResponse(baseRow)
		expect(res.fulfilled).toBeUndefined()
	})

	it("includes fulfilled when badge provided", () => {
		const res = toResponse(baseRow, {
			demand: 3.5,
			requestCount: 2,
			fulfilledAt: 1700000000,
		})
		expect(res.fulfilled).toEqual({
			demand: 3.5,
			requestCount: 2,
			fulfilledAt: 1700000000,
		})
	})

	it("passes null through as undefined", () => {
		const res = toResponse(baseRow, null)
		expect(res.fulfilled).toBeUndefined()
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
		submitter_id: null,
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

	it("exposes submitter when key id and reputation are present", () => {
		const keyId = "deadbeef".repeat(8)
		const result = toSearchResponse({
			...baseSearchRow,
			submitter_id: 99,
			submitter_key_id: keyId,
			submitter_reputation: 1.42,
			submitter_nickname: "Curator Cat",
		})
		expect(result.submitter).toEqual({ keyId, reputation: 1.42, displayName: "Curator Cat" })
	})

	it("falls back to a pet name when nickname is null", () => {
		const keyId = "abcdef12".repeat(8)
		const result = toSearchResponse({
			...baseSearchRow,
			submitter_id: 5,
			submitter_key_id: keyId,
			submitter_reputation: 1,
			submitter_nickname: null,
		})
		expect(result.submitter).toEqual({
			keyId,
			reputation: 1,
			displayName: generatePetName(keyId),
		})
	})

	it("omits submitter for anonymous rows", () => {
		expect(toSearchResponse(baseSearchRow).submitter).toBeUndefined()
	})
})
