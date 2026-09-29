import { config } from "@/config"
import { describe, expect, it } from "vitest"
import { parseMetadataProposal } from "./metadata-input"

const VIDEO = "dQw4w9WgXcQ"

describe("parseMetadataProposal", () => {
	it("trims every field", () => {
		expect(
			parseMetadataProposal({ videoId: VIDEO, song: "  Song ", artist: " Artist ", album: " LP " })
		).toEqual({ videoId: VIDEO, song: "Song", artist: "Artist", album: "LP" })
	})

	describe("edge cases", () => {
		it("turns an empty or missing album into null", () => {
			expect(
				parseMetadataProposal({ videoId: VIDEO, song: "S", artist: "A", album: "  " })?.album
			).toBeNull()
			expect(parseMetadataProposal({ videoId: VIDEO, song: "S", artist: "A" })?.album).toBeNull()
			expect(
				parseMetadataProposal({ videoId: VIDEO, song: "S", artist: "A", album: null })?.album
			).toBeNull()
		})

		it("accepts the maximum length", () => {
			const song = "x".repeat(config.validation.song.maxLength)
			expect(parseMetadataProposal({ videoId: VIDEO, song, artist: "A" })?.song).toBe(song)
		})

		it("keeps unicode", () => {
			expect(
				parseMetadataProposal({ videoId: VIDEO, song: "夜に駆ける", artist: "YOASOBI" })?.song
			).toBe("夜に駆ける")
		})
	})

	describe("invariants", () => {
		it("is idempotent on its own output", () => {
			const once = parseMetadataProposal({
				videoId: VIDEO,
				song: " S ",
				artist: " A ",
				album: " L ",
			})
			expect(parseMetadataProposal({ ...once })).toEqual(once)
		})
	})

	describe("error paths", () => {
		it.each([
			["bad video id", { videoId: "nope", song: "S", artist: "A" }],
			["missing video id", { song: "S", artist: "A" }],
			["blank song", { videoId: VIDEO, song: "  ", artist: "A" }],
			["blank artist", { videoId: VIDEO, song: "S", artist: "" }],
			[
				"song too long",
				{ videoId: VIDEO, song: "x".repeat(config.validation.song.maxLength + 1), artist: "A" },
			],
			[
				"artist too long",
				{ videoId: VIDEO, song: "S", artist: "x".repeat(config.validation.artist.maxLength + 1) },
			],
			["multi-line album", { videoId: VIDEO, song: "S", artist: "A", album: "a\nb" }],
			["control char in song", { videoId: VIDEO, song: "S\u0007", artist: "A" }],
			["line separator in artist", { videoId: VIDEO, song: "S", artist: "A\u2028B" }],
			["non-string song", { videoId: VIDEO, song: 5, artist: "A" }],
			["non-string album", { videoId: VIDEO, song: "S", artist: "A", album: 5 }],
		])("rejects %s", (_, body) => {
			expect(parseMetadataProposal(body as Record<string, unknown>)).toBeNull()
		})
	})
})
