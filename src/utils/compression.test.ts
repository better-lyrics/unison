import { describe, expect, it } from "vitest"
import { compress, decompressIfNeeded } from "./compression"

describe("decompressIfNeeded", () => {
	it("decompresses stored lyrics", async () => {
		const lyrics = "[00:12.00]Amazing grace! How sweet the sound"
		expect(await decompressIfNeeded(await compress(lyrics))).toBe(lyrics)
	})

	describe("edge cases", () => {
		it("passes uncompressed legacy content through", async () => {
			expect(await decompressIfNeeded("Amazing grace! How sweet the sound")).toBe(
				"Amazing grace! How sweet the sound"
			)
		})

		it("passes short strings through", async () => {
			expect(await decompressIfNeeded("gz")).toBe("gz")
		})

		it("round-trips unicode", async () => {
			const lyrics = "私は歌を歌います 🎵"
			expect(await decompressIfNeeded(await compress(lyrics))).toBe(lyrics)
		})
	})
})
