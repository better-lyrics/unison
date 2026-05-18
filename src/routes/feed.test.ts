import type { FeedItem } from "@/types"
import { describe, expect, it } from "vitest"
import { toFeedResponse } from "./feed"

const baseItem: FeedItem = {
	id: 1,
	video_id: "v",
	song: "S",
	artist: "A",
	album: null,
	isrc: null,
	duration: 100,
	format: "lrc",
	language: null,
	sync_type: "linesync",
	score: 0,
	effective_score: 0,
	vote_count: 0,
	confidence: "low",
	created_at: 1700000000,
}

describe("toFeedResponse", () => {
	it("defaults hidden to false when the row omits it", () => {
		expect(toFeedResponse(baseItem).hidden).toBe(false)
	})

	it("passes through hidden when present", () => {
		expect(toFeedResponse({ ...baseItem, hidden: true }).hidden).toBe(true)
	})
})
