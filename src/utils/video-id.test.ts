import { describe, expect, it } from "vitest"
import { isVideoId } from "./video-id"

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
