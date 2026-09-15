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

describe("getVideoDurationSeconds", () => {
	it("returns the basic_info duration in seconds", async () => {
		create.mockResolvedValue({
			music: { getInfo: async () => ({ basic_info: { duration: 213 } }) },
		})
		const { getVideoDurationSeconds } = await import("./innertube")
		expect(await getVideoDurationSeconds("vid")).toBe(213)
	})

	describe("edge cases", () => {
		it("returns null when duration is absent", async () => {
			create.mockResolvedValue({
				music: { getInfo: async () => ({ basic_info: {} }) },
			})
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
		})

		it("returns null (fail-closed) when the lookup throws", async () => {
			create.mockResolvedValue({
				music: {
					getInfo: async () => {
						throw new Error("private video")
					},
				},
			})
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
		})
	})
})

describe("searchSongs", () => {
	it("maps song and video shelves, tags the video type, captures artist channel ids, and drops items without a video id", async () => {
		create.mockResolvedValue({
			music: {
				search: async () => ({
					songs: {
						contents: [
							{
								id: "vid1",
								title: "Song One",
								artists: [{ name: "Artist A", channel_id: "UCartistA" }, { name: "Artist B" }],
								album: { name: "Album X" },
								duration: { seconds: 200 },
							},
							{ title: "No Id", artists: [{ name: "B" }] },
							{ id: "vid3", title: "Sparse" },
						],
					},
					videos: {
						contents: [
							{
								id: "clip1",
								title: "Song One (Official Video)",
								authors: [{ name: "Artist A", channel_id: "UCartistA" }],
								duration: { seconds: 210 },
							},
						],
					},
				}),
			},
		})
		const { searchSongs } = await import("./innertube")
		expect(await searchSongs("song one artist a")).toEqual([
			{
				videoId: "vid1",
				title: "Song One",
				artist: "Artist A",
				artists: ["Artist A", "Artist B"],
				artistChannelIds: ["UCartistA"],
				album: "Album X",
				durationSeconds: 200,
				videoType: "song",
			},
			{
				videoId: "vid3",
				title: "Sparse",
				artist: "",
				artists: [],
				artistChannelIds: [],
				album: null,
				durationSeconds: null,
				videoType: "song",
			},
			{
				videoId: "clip1",
				title: "Song One (Official Video)",
				artist: "Artist A",
				artists: ["Artist A"],
				artistChannelIds: ["UCartistA"],
				album: null,
				durationSeconds: 210,
				videoType: "video",
			},
		])
	})

	describe("edge cases", () => {
		it("returns an empty array when there are no results in either shelf", async () => {
			create.mockResolvedValue({ music: { search: async () => ({}) } })
			const { searchSongs } = await import("./innertube")
			expect(await searchSongs("nothing")).toEqual([])
		})

		it("returns an empty array (fail-closed) when the search throws", async () => {
			create.mockResolvedValue({
				music: {
					search: async () => {
						throw new Error("rate limited")
					},
				},
			})
			const { searchSongs } = await import("./innertube")
			expect(await searchSongs("boom")).toEqual([])
		})
	})
})
