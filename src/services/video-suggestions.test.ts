import type { SongCandidate } from "@/utils/innertube"
import { describe, expect, it } from "vitest"
import { buildSuggestions } from "./video-suggestions"

const META = { song: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200 }

function candidate(over: Partial<SongCandidate> & Pick<SongCandidate, "videoId">): SongCandidate {
	return {
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		album: "After Hours",
		durationSeconds: 200,
		videoType: "song",
		...over,
	}
}

describe("buildSuggestions", () => {
	it("scores an exact match and flags the duration guardrail", () => {
		const [s] = buildSuggestions([candidate({ videoId: "atv1" })], META, new Set())
		expect(s.matchScore).toBeCloseTo(1)
		expect(s.withinDurationDelta).toBe(true)
		expect(s.videoType).toBe("song")
	})

	it("ranks song (audio) above video regardless of match score", () => {
		const out = buildSuggestions(
			[
				candidate({ videoId: "strongvideo", videoType: "video", durationSeconds: 200 }),
				candidate({
					videoId: "weaksong",
					title: "Totally Different Title",
					videoType: "song",
					album: null,
				}),
			],
			META,
			new Set()
		)
		expect(out.map((s) => s.videoId)).toEqual(["weaksong", "strongvideo"])
	})

	it("orders by match score, then duration guardrail, within a video type", () => {
		const out = buildSuggestions(
			[
				candidate({ videoId: "titleonly", album: null, durationSeconds: 999 }),
				candidate({ videoId: "exact" }),
				candidate({ videoId: "titleonly_near", album: null, durationSeconds: 201 }),
			],
			META,
			new Set()
		)
		expect(out.map((s) => s.videoId)).toEqual(["exact", "titleonly_near", "titleonly"])
	})

	describe("artist filter", () => {
		it("drops candidates by a different artist", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "other", artist: "Someone Else", artists: ["Someone Else"] })],
				META,
				new Set()
			)
			expect(out).toEqual([])
		})

		it("keeps a collaboration where the artist is one of several", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "collab", artists: ["Daft Punk", "The Weeknd"] })],
				META,
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["collab"])
		})

		it("tolerates a - Topic channel suffix", () => {
			const out = buildSuggestions(
				[
					candidate({
						videoId: "topic",
						artist: "The Weeknd - Topic",
						artists: ["The Weeknd - Topic"],
					}),
				],
				META,
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["topic"])
		})

		it("tolerates a feat. credit on the candidate", () => {
			const out = buildSuggestions(
				[
					candidate({
						videoId: "feat",
						artist: "The Weeknd feat. Daft Punk",
						artists: ["The Weeknd feat. Daft Punk"],
					}),
				],
				META,
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["feat"])
		})
	})

	it("excludes already-linked videos", () => {
		const out = buildSuggestions(
			[candidate({ videoId: "linked" }), candidate({ videoId: "fresh" })],
			META,
			new Set(["linked"])
		)
		expect(out.map((s) => s.videoId)).toEqual(["fresh"])
	})

	describe("edge cases", () => {
		it("returns [] for no candidates", () => {
			expect(buildSuggestions([], META, new Set())).toEqual([])
		})

		it("does not filter by artist when the lyric has no artist", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "any", artist: "Whoever", artists: ["Whoever"] })],
				{ ...META, artist: "" },
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["any"])
		})

		it("flags a null duration as outside the guardrail", () => {
			const [s] = buildSuggestions(
				[candidate({ videoId: "nodur", durationSeconds: null })],
				META,
				new Set()
			)
			expect(s.withinDurationDelta).toBe(false)
		})

		it("falls back to the primary artist when the artists list is empty", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "primaryonly", artist: "The Weeknd", artists: [] })],
				META,
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["primaryonly"])
		})

		it("drops an authorless candidate with no artist to match", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "authorless", artist: "", artists: [] })],
				META,
				new Set()
			)
			expect(out).toEqual([])
		})

		it("matches against an album-less lyric on title and artist only", () => {
			const [s] = buildSuggestions(
				[candidate({ videoId: "noalbum" })],
				{ ...META, album: null },
				new Set()
			)
			expect(s.matchScore).toBeCloseTo(0.8)
		})
	})

	describe("invariants", () => {
		it("does not mutate the input candidates", () => {
			const input = [candidate({ videoId: "a" }), candidate({ videoId: "b", videoType: "video" })]
			const snapshot = JSON.stringify(input)
			buildSuggestions(input, META, new Set())
			expect(JSON.stringify(input)).toBe(snapshot)
		})

		it("returns every song-type suggestion before any video-type one", () => {
			const out = buildSuggestions(
				[
					candidate({ videoId: "v1", videoType: "video" }),
					candidate({ videoId: "s1", videoType: "song" }),
					candidate({ videoId: "v2", videoType: "video" }),
					candidate({ videoId: "s2", videoType: "song" }),
				],
				META,
				new Set()
			)
			const firstVideo = out.findIndex((s) => s.videoType === "video")
			const lastSong = out.map((s) => s.videoType).lastIndexOf("song")
			expect(lastSong).toBeLessThan(firstVideo)
		})
	})
})
