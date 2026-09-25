import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { SongCandidate } from "@/utils/innertube"
import { describe, expect, it, vi } from "vitest"
import { buildSuggestions, suggestVideosForSong } from "./video-suggestions"

const META = {
	song: "Blinding Lights",
	artist: "The Weeknd",
	album: "After Hours",
	duration: 200,
	videoId: "homevideo000",
}

function candidate(over: Partial<SongCandidate> & Pick<SongCandidate, "videoId">): SongCandidate {
	return {
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		artistChannelIds: [],
		album: "After Hours",
		durationSeconds: 200,
		videoType: "song",
		artworkUrl: null,
		...over,
	}
}

describe("buildSuggestions", () => {
	it("scores an exact match", () => {
		const [s] = buildSuggestions([candidate({ videoId: "atv1" })], META, new Set())
		expect(s.matchScore).toBeCloseTo(1)
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

	it("orders by match score within a video type and drops candidates outside the duration gate", () => {
		const out = buildSuggestions(
			[
				candidate({ videoId: "faroff", album: null, durationSeconds: 999 }),
				candidate({ videoId: "exact" }),
				candidate({ videoId: "titleonly_near", album: null, durationSeconds: 201 }),
			],
			META,
			new Set()
		)
		expect(out.map((s) => s.videoId)).toEqual(["exact", "titleonly_near"])
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

	describe("artist channel id matching", () => {
		it("matches by shared channel id and drops a same-named artist with a different id", () => {
			const out = buildSuggestions(
				[
					candidate({ videoId: "anchor00000", artistChannelIds: ["UCweeknd"] }),
					candidate({ videoId: "sameid", artistChannelIds: ["UCweeknd"] }),
					candidate({ videoId: "diffid", artistChannelIds: ["UCimpostor"] }),
				],
				{ ...META, videoId: "anchor00000" },
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["sameid"])
		})

		it("keeps a comma-in-name artist by channel id without fragmenting the name", () => {
			const out = buildSuggestions(
				[
					candidate({
						videoId: "anchorT0000",
						artist: "Tyler, the Creator",
						artists: ["Tyler, the Creator"],
						artistChannelIds: ["UCtyler"],
					}),
					candidate({
						videoId: "tylertrack",
						artist: "Tyler, the Creator",
						artists: ["Tyler, the Creator"],
						artistChannelIds: ["UCtyler"],
					}),
					candidate({
						videoId: "fragment000",
						artist: "the Creator",
						artists: ["the Creator"],
						artistChannelIds: ["UCsomeoneelse"],
					}),
				],
				{
					song: "Yonkers",
					artist: "Tyler, the Creator",
					album: null,
					duration: 200,
					videoId: "anchorT0000",
				},
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["tylertrack"])
		})

		it("keeps a composite-credit candidate that shares one artist id", () => {
			const out = buildSuggestions(
				[
					candidate({ videoId: "anchorW0000", artistChannelIds: ["UCweeknd"] }),
					candidate({
						videoId: "collab",
						artist: "The Weeknd",
						artists: ["The Weeknd", "Drake", "Future"],
						artistChannelIds: ["UCweeknd", "UCdrake", "UCfuture"],
					}),
				],
				{ ...META, videoId: "anchorW0000" },
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["collab"])
		})

		it("resolves the reference artist from the best exact match when the variant video is absent", () => {
			const out = buildSuggestions(
				[
					candidate({ videoId: "exactref", artistChannelIds: ["UCweeknd"] }),
					candidate({ videoId: "diffid", artistChannelIds: ["UCimpostor"] }),
				],
				{ ...META, videoId: "notpresent0" },
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["exactref"])
		})

		it("falls back to name matching when neither side has channel ids", () => {
			const out = buildSuggestions(
				[
					candidate({ videoId: "weeknd" }),
					candidate({ videoId: "ana", artist: "Anastasia", artists: ["Anastasia"] }),
				],
				{ ...META, videoId: "notpresent0" },
				new Set()
			)
			expect(out.map((s) => s.videoId)).toEqual(["weeknd"])
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

	it("excludes the variant's own video", () => {
		const out = buildSuggestions(
			[candidate({ videoId: "self0000000" }), candidate({ videoId: "fresh" })],
			{ ...META, videoId: "self0000000" },
			new Set()
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

		it("drops a candidate with unknown duration (fails the duration gate)", () => {
			const out = buildSuggestions(
				[candidate({ videoId: "nodur", durationSeconds: null })],
				META,
				new Set()
			)
			expect(out).toEqual([])
		})

		it("regression: does not keep a substring-only artist match", () => {
			const out = buildSuggestions(
				[
					candidate({
						videoId: "ana",
						title: "Chandelier",
						artist: "Anastasia",
						artists: ["Anastasia"],
					}),
				],
				{ song: "Chandelier", artist: "Sia", album: null, duration: 200, videoId: "notpresent0" },
				new Set()
			)
			expect(out).toEqual([])
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

describe("suggestVideosForSong", () => {
	const env = () => ({ CACHE: makeMemoryCache() }) as unknown as Env
	const SONG = { song: "Blinding Lights", artist: "The Weeknd", duration: 200 }

	it("suggests same-song videos for a lyric that has not been submitted yet", async () => {
		const search = vi.fn(async () => [
			candidate({ videoId: "fHI8X4OXluQ" }),
			candidate({ videoId: "4NRXx6U8ABQ", videoType: "video", album: null }),
		])
		const out = await suggestVideosForSong(env(), { ...SONG, album: "After Hours" }, { search })
		expect(out.map((s) => s.videoId)).toEqual(["fHI8X4OXluQ", "4NRXx6U8ABQ"])
		expect(out[0].matchScore).toBeCloseTo(1)
		expect(search).toHaveBeenCalledWith("Blinding Lights The Weeknd")
	})

	it("excludes the video the lyric is being submitted for", async () => {
		const search = async () => [
			candidate({ videoId: "fHI8X4OXluQ" }),
			candidate({ videoId: "4NRXx6U8ABQ", videoType: "video" }),
		]
		const out = await suggestVideosForSong(env(), { ...SONG, videoId: "fHI8X4OXluQ" }, { search })
		expect(out.map((s) => s.videoId)).toEqual(["4NRXx6U8ABQ"])
	})

	describe("edge cases", () => {
		it("scores without an album when none is given", async () => {
			const out = await suggestVideosForSong(env(), SONG, {
				search: async () => [candidate({ videoId: "fHI8X4OXluQ" })],
			})
			expect(out[0].matchScore).toBeCloseTo(0.8)
		})

		it("treats a null album like a missing one", async () => {
			const out = await suggestVideosForSong(
				env(),
				{ ...SONG, album: null },
				{
					search: async () => [candidate({ videoId: "fHI8X4OXluQ" })],
				}
			)
			expect(out[0].matchScore).toBeCloseTo(0.8)
		})

		it("returns [] when the search finds nothing", async () => {
			expect(await suggestVideosForSong(env(), SONG, { search: async () => [] })).toEqual([])
		})

		it("applies the duration gate against the given duration", async () => {
			const out = await suggestVideosForSong(env(), SONG, {
				search: async () => [
					candidate({ videoId: "fHI8X4OXluQ", durationSeconds: 202 }),
					candidate({ videoId: "4NRXx6U8ABQ", durationSeconds: 203 }),
				],
			})
			expect(out.map((s) => s.videoId)).toEqual(["fHI8X4OXluQ"])
		})
	})

	describe("invariants", () => {
		it("filters exactly like buildSuggestions with nothing linked", async () => {
			const candidates = [
				candidate({ videoId: "fHI8X4OXluQ" }),
				candidate({ videoId: "other000000", artist: "Someone", artists: ["Someone"] }),
				candidate({ videoId: "4NRXx6U8ABQ", videoType: "video", durationSeconds: 199 }),
			]
			const out = await suggestVideosForSong(
				env(),
				{ ...SONG, album: "After Hours", videoId: "dQw4w9WgXcQ" },
				{ search: async () => candidates }
			)
			expect(out).toEqual(
				buildSuggestions(
					candidates,
					{ ...SONG, album: "After Hours", videoId: "dQw4w9WgXcQ" },
					new Set()
				)
			)
		})

		it("shares the cached search with the owner route and link verification", async () => {
			const e = env()
			const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
			await suggestVideosForSong(e, SONG, { search })
			await suggestVideosForSong(e, { ...SONG, videoId: "fHI8X4OXluQ" }, { search })
			expect(search).toHaveBeenCalledTimes(1)
		})
	})
})
