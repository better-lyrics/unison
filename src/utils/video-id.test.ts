import { describe, expect, it } from "vitest"
import { isVideoId, videoIdFromInput } from "./video-id"

describe("isVideoId", () => {
	it("accepts real YouTube video ids", () => {
		for (const id of ["dQw4w9WgXcQ", "R-hYM3BqTbA", "0cBHeagy-S4", "kJQP7kiw5Fk", "a_b-C_d-E_f"])
			expect(isVideoId(id)).toBe(true)
	})

	describe("edge cases", () => {
		it("rejects ids of the wrong length", () => {
			for (const id of ["", "dQw4w9WgXc", "dQw4w9WgXcQQ"]) expect(isVideoId(id)).toBe(false)
		})
		it("rejects ids with characters outside the YouTube alphabet", () => {
			for (const id of [" dQw4w9WgXc", "dQw4w9WgXc/", "dQw4w9WgXc=", "dQw4w9WgXcé", "!!!!!!!!!!!"])
				expect(isVideoId(id)).toBe(false)
		})
		it("rejects ids with surrounding or embedded newlines", () => {
			expect(isVideoId("dQw4w9WgXcQ\n")).toBe(false)
			expect(isVideoId("dQw4w\nWgXcQ")).toBe(false)
		})
	})

	describe("error paths", () => {
		it("rejects non-string input", () => {
			for (const value of [42, null, undefined, {}, ["dQw4w9WgXcQ"]])
				expect(isVideoId(value)).toBe(false)
		})
	})
})

describe("videoIdFromInput", () => {
	it("accepts a bare video id", () => {
		expect(videoIdFromInput("a-b_c123456")).toBe("a-b_c123456")
	})

	it("reads the id from YouTube Music, YouTube and short links", () => {
		for (const link of [
			"https://music.youtube.com/watch?v=9yfrVqCcrS0&si=cQ3SU5WVYjJvKbhq",
			"https://www.youtube.com/watch?v=9yfrVqCcrS0",
			"https://m.youtube.com/watch?v=9yfrVqCcrS0",
			"https://youtu.be/9yfrVqCcrS0?si=k-QGhtw2NsdmnzVI",
			"music.youtube.com/watch?v=9yfrVqCcrS0",
			"https://www.youtube.com/shorts/9yfrVqCcrS0?feature=share",
			"https://www.youtube.com/embed/9yfrVqCcrS0",
			"https://www.youtube-nocookie.com/embed/9yfrVqCcrS0",
			"https://www.youtube.com/live/9yfrVqCcrS0?si=abc",
			"https://youtu.be/9yfrVqCcrS0/",
		]) {
			expect(videoIdFromInput(link), link).toBe("9yfrVqCcrS0")
		}
	})

	describe("regressions", () => {
		it("regression: recovers the id from a pasted fragment of a link", () => {
			const fragments: [string, string][] = [
				["8ylRSepPra4&si", "8ylRSepPra4"],
				["zVAvU18sY_w&list=OLAK5uy_nG6kfrik9Q6D1GL", "zVAvU18sY_w"],
				["v=5iGHe72I5Ho", "5iGHe72I5Ho"],
				["=rHfkyeQ-S44", "rHfkyeQ-S44"],
				["PH7Fz26Bwr8&list=LM", "PH7Fz26Bwr8"],
				["watch?v=5iGHe72I5Ho", "5iGHe72I5Ho"],
				["/watch?v=5iGHe72I5Ho&si=x", "5iGHe72I5Ho"],
				["?v=5iGHe72I5Ho", "5iGHe72I5Ho"],
			]
			for (const [input, id] of fragments) expect(videoIdFromInput(input), input).toBe(id)
		})

		it("regression: rejects values that are not a video id", () => {
			for (const input of [
				"local-file",
				"e.d  rt",
				"t7AcyLcqkIWx6a23",
				"-DpPkA823YJc",
				"BzhIJNuWTM",
				"3P3QSMOICc&list=MLPT",
				"<div id='rg_embed_link_13826800' class='rg_embed_link'>",
			]) {
				expect(videoIdFromInput(input), input).toBeNull()
			}
		})
	})

	describe("edge cases", () => {
		it("ignores surrounding whitespace", () => {
			expect(videoIdFromInput("  https://youtu.be/dQw4w9WgXcQ \n")).toBe("dQw4w9WgXcQ")
		})

		it("returns null for empty input and plain text", () => {
			expect(videoIdFromInput("")).toBeNull()
			expect(videoIdFromInput("never gonna")).toBeNull()
		})

		it("returns null for a link to another site or a non-watch page", () => {
			expect(videoIdFromInput("https://open.spotify.com/track/2kD5bGkc4Inh6Uel6wfRK8")).toBeNull()
			expect(videoIdFromInput("https://www.youtube.com/channel/UC1234567890")).toBeNull()
			expect(videoIdFromInput("https://www.youtube.com/shorts/short")).toBeNull()
			expect(videoIdFromInput("https://example.com/embed/9yfrVqCcrS0")).toBeNull()
			expect(videoIdFromInput("https://www.youtube.com/playlist?list=PL9yfrVqCcrS0")).toBeNull()
		})
	})

	describe("invariants", () => {
		it("always returns a valid id or null", () => {
			for (const input of ["dQw4w9WgXcQ", "x", "https://youtu.be/", "v=", "&&&&&&&&&&&"]) {
				const id = videoIdFromInput(input)
				expect(id === null || isVideoId(id), input).toBe(true)
			}
		})

		it("is idempotent", () => {
			const id = videoIdFromInput("https://youtu.be/dQw4w9WgXcQ?si=abc")
			expect(id && videoIdFromInput(id)).toBe(id)
		})
	})
})
