import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("youtubei.js", () => ({ Innertube: { create } }))

function fakeClient() {
	return {
		music: {
			getInfo: async () => ({
				basic_info: { thumbnail: [{ url: "https://art=w1-h1", width: 100, height: 100 }] },
			}),
		},
	}
}

beforeEach(() => {
	vi.resetModules()
	create.mockReset()
})

afterEach(() => {
	vi.resetModules()
})

describe("getSquareArtworkUrl", () => {
	it("resolves the largest square thumbnail rewritten to the requested size", async () => {
		create.mockResolvedValue(fakeClient())
		const { getSquareArtworkUrl } = await import("./innertube")
		expect(await getSquareArtworkUrl("vid", 600)).toBe("https://art=w600-h600")
	})

	it("memoizes the client across calls when creation succeeds", async () => {
		create.mockResolvedValue(fakeClient())
		const { getSquareArtworkUrl } = await import("./innertube")
		await getSquareArtworkUrl("vid", 600)
		await getSquareArtworkUrl("vid2", 600)
		expect(create).toHaveBeenCalledTimes(1)
	})

	describe("error paths", () => {
		it("returns null when the client resolves but the lookup fails", async () => {
			create.mockResolvedValue({
				music: {
					getInfo: async () => {
						throw new Error("not found")
					},
				},
			})
			const { getSquareArtworkUrl } = await import("./innertube")
			expect(await getSquareArtworkUrl("vid", 600)).toBeNull()
		})

		it("regression: retries client creation after a failed first init instead of caching the rejection", async () => {
			create.mockRejectedValueOnce(new Error("network blip"))
			create.mockResolvedValueOnce(fakeClient())
			const { getSquareArtworkUrl } = await import("./innertube")
			expect(await getSquareArtworkUrl("vid", 600)).toBeNull()
			expect(await getSquareArtworkUrl("vid", 600)).toBe("https://art=w600-h600")
			expect(create).toHaveBeenCalledTimes(2)
		})
	})
})
