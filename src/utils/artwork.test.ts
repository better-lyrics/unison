import { describe, expect, it } from "vitest"
import { isAlbumArtUrl, normalizeArtworkUrl, pickSquareArtwork } from "@/utils/artwork"

describe("isAlbumArtUrl", () => {
	it("accepts googleusercontent square art", () => {
		expect(isAlbumArtUrl("https://yt3.googleusercontent.com/abc=w544-h544-l90-rj")).toBe(true)
		expect(isAlbumArtUrl("https://lh3.googleusercontent.com/xyz=w120-h120")).toBe(true)
	})
	describe("edge cases", () => {
		it("rejects ytimg video thumbnails", () => {
			expect(isAlbumArtUrl("https://i.ytimg.com/vi/kJQP7kiw5Fk/hq720.jpg")).toBe(false)
			expect(isAlbumArtUrl("https://i.ytimg.com/vi/x/maxresdefault.jpg")).toBe(false)
		})
		it("rejects non-square googleusercontent", () => {
			expect(isAlbumArtUrl("https://yt3.googleusercontent.com/abc=w544-h306-l90-rj")).toBe(false)
		})
		it("rejects googleusercontent without a size suffix", () => {
			expect(isAlbumArtUrl("https://yt3.googleusercontent.com/abc")).toBe(false)
		})
		it("rejects empty, null, and junk", () => {
			expect(isAlbumArtUrl("")).toBe(false)
			expect(isAlbumArtUrl(null)).toBe(false)
			expect(isAlbumArtUrl(undefined)).toBe(false)
			expect(isAlbumArtUrl("not a url")).toBe(false)
		})
	})
})

describe("normalizeArtworkUrl", () => {
	it("rewrites the size suffix", () => {
		expect(normalizeArtworkUrl("https://yt3.googleusercontent.com/a=w544-h544-l90-rj", 600)).toBe(
			"https://yt3.googleusercontent.com/a=w600-h600-l90-rj"
		)
	})
	it("returns the url unchanged when there is no size suffix", () => {
		expect(normalizeArtworkUrl("https://x/y.jpg", 600)).toBe("https://x/y.jpg")
	})
})

describe("pickSquareArtwork", () => {
	it("picks the largest square and rewrites size", () => {
		const thumbs = [
			{ url: "https://yt3.googleusercontent.com/a=w60-h60", width: 60, height: 60 },
			{ url: "https://yt3.googleusercontent.com/a=w544-h544", width: 544, height: 544 },
		]
		expect(pickSquareArtwork(thumbs, 600)).toBe("https://yt3.googleusercontent.com/a=w600-h600")
	})
	describe("edge cases", () => {
		it("returns null when no square thumbnail exists", () => {
			expect(pickSquareArtwork([{ url: "u", width: 853, height: 480 }], 600)).toBeNull()
		})
		it("returns null for an empty list", () => {
			expect(pickSquareArtwork([], 600)).toBeNull()
		})
	})
})
