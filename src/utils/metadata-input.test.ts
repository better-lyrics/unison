import { config } from "@/config"
import { describe, expect, it } from "vitest"
import { parseMetadataProposal } from "./metadata-input"

const VIDEO = "dQw4w9WgXcQ"

describe("parseMetadataProposal", () => {
	it("trims every field", () => {
		expect(
			parseMetadataProposal({
				videoId: VIDEO,
				lyricsId: 7,
				song: "  Song ",
				artist: " Artist ",
				album: " LP ",
			})
		).toEqual({ videoId: VIDEO, lyricsId: 7, song: "Song", artist: "Artist", album: "LP" })
	})

	describe("edge cases", () => {
		it("turns an empty or missing album into null", () => {
			expect(
				parseMetadataProposal({ videoId: VIDEO, lyricsId: 7, song: "S", artist: "A", album: "  " })
					?.album
			).toBeNull()
			expect(
				parseMetadataProposal({ videoId: VIDEO, lyricsId: 7, song: "S", artist: "A" })?.album
			).toBeNull()
			expect(
				parseMetadataProposal({ videoId: VIDEO, lyricsId: 7, song: "S", artist: "A", album: null })
					?.album
			).toBeNull()
		})

		it("accepts the maximum length", () => {
			const song = "x".repeat(config.validation.song.maxLength)
			expect(parseMetadataProposal({ videoId: VIDEO, lyricsId: 7, song, artist: "A" })?.song).toBe(
				song
			)
		})

		it("keeps unicode", () => {
			expect(
				parseMetadataProposal({
					videoId: VIDEO,
					lyricsId: 7,
					song: "夜に駆ける",
					artist: "YOASOBI",
				})?.song
			).toBe("夜に駆ける")
		})
	})

	describe("invariants", () => {
		it("is idempotent on its own output", () => {
			const once = parseMetadataProposal({
				videoId: VIDEO,
				lyricsId: 7,
				song: " S ",
				artist: " A ",
				album: " L ",
			})
			expect(parseMetadataProposal({ ...once })).toEqual(once)
		})
	})

	describe("error paths", () => {
		it.each([
			["bad video id", { videoId: "nope", lyricsId: 7, song: "S", artist: "A" }],
			["missing lyric id", { videoId: VIDEO, song: "S", artist: "A" }],
			["zero lyric id", { videoId: VIDEO, lyricsId: 0, song: "S", artist: "A" }],
			["fractional lyric id", { videoId: VIDEO, lyricsId: 1.5, song: "S", artist: "A" }],
			["string lyric id", { videoId: VIDEO, lyricsId: "7", song: "S", artist: "A" }],
			["missing video id", { lyricsId: 7, song: "S", artist: "A" }],
			["blank song", { videoId: VIDEO, lyricsId: 7, song: "  ", artist: "A" }],
			["blank artist", { videoId: VIDEO, lyricsId: 7, song: "S", artist: "" }],
			[
				"song too long",
				{
					videoId: VIDEO,
					lyricsId: 7,
					song: "x".repeat(config.validation.song.maxLength + 1),
					artist: "A",
				},
			],
			[
				"artist too long",
				{
					videoId: VIDEO,
					lyricsId: 7,
					song: "S",
					artist: "x".repeat(config.validation.artist.maxLength + 1),
				},
			],
			["multi-line album", { videoId: VIDEO, lyricsId: 7, song: "S", artist: "A", album: "a\nb" }],
			["control char in song", { videoId: VIDEO, lyricsId: 7, song: "S\u0007", artist: "A" }],
			["line separator in artist", { videoId: VIDEO, lyricsId: 7, song: "S", artist: "A\u2028B" }],
			["non-string song", { videoId: VIDEO, lyricsId: 7, song: 5, artist: "A" }],
			["non-string album", { videoId: VIDEO, lyricsId: 7, song: "S", artist: "A", album: 5 }],
		])("rejects %s", (_, body) => {
			expect(parseMetadataProposal(body as Record<string, unknown>)).toBeNull()
		})
	})
})
