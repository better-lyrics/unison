import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("youtubei.js", () => ({ Innertube: { create } }))

function basicInfoClient(duration: number | undefined) {
	return {
		getBasicInfo: vi.fn(async () => ({ basic_info: { duration } })),
		music: {
			getInfo: async () => {
				throw new Error("music.getInfo must not be called")
			},
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

describe("getVideoDurationSeconds", () => {
	it("returns the basic_info duration in seconds", async () => {
		create.mockResolvedValue(basicInfoClient(213))
		const { getVideoDurationSeconds } = await import("./innertube")
		expect(await getVideoDurationSeconds("vid")).toBe(213)
	})

	it("asks the player for basic info through the pinned client", async () => {
		const client = basicInfoClient(213)
		create.mockResolvedValue(client)
		const { BASIC_INFO_CLIENT, getVideoDurationSeconds } = await import("./innertube")
		await getVideoDurationSeconds("dQw4w9WgXcQ")
		expect(BASIC_INFO_CLIENT).toBe("ANDROID_VR")
		expect(client.getBasicInfo).toHaveBeenCalledWith("dQw4w9WgXcQ", { client: "ANDROID_VR" })
	})

	it("memoizes the client across calls when creation succeeds", async () => {
		create.mockResolvedValue(basicInfoClient(213))
		const { getVideoDurationSeconds } = await import("./innertube")
		await getVideoDurationSeconds("vid")
		await getVideoDurationSeconds("vid2")
		expect(create).toHaveBeenCalledTimes(1)
	})

	describe("edge cases", () => {
		it("returns null when duration is absent", async () => {
			create.mockResolvedValue(basicInfoClient(undefined))
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
		})
	})

	describe("error paths", () => {
		it("returns null (fail-closed) when the lookup throws", async () => {
			create.mockResolvedValue({
				getBasicInfo: async () => {
					throw new Error("private video")
				},
			})
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
		})

		it("regression: retries client creation after a failed first init instead of caching the rejection", async () => {
			create.mockRejectedValueOnce(new Error("network blip"))
			create.mockResolvedValueOnce(basicInfoClient(213))
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
			expect(await getVideoDurationSeconds("vid")).toBe(213)
			expect(create).toHaveBeenCalledTimes(2)
		})
	})

	describe("regressions", () => {
		it("regression: never goes through music.getInfo, whose YTMUSIC player call is LOGIN_REQUIRED from datacenter IPs", async () => {
			create.mockResolvedValue(basicInfoClient(213))
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBe(213)
		})

		it("regression: a LOGIN_REQUIRED player response without video details yields null, not a throw", async () => {
			create.mockResolvedValue({
				getBasicInfo: async () => ({
					basic_info: {},
					playability_status: { status: "LOGIN_REQUIRED" },
				}),
			})
			const { getVideoDurationSeconds } = await import("./innertube")
			expect(await getVideoDurationSeconds("vid")).toBeNull()
		})
	})
})

describe("searchSongs", () => {
	it("maps song and video shelves, keeps square album art only, tags the video type, captures artist channel ids, and drops items without a video id", async () => {
		create.mockResolvedValue({
			music: {
				search: async (_query: string, { type }: { type: string }) => ({
					songs:
						type !== "song"
							? undefined
							: {
									contents: [
										{
											id: "vid1",
											title: "Song One",
											artists: [
												{ name: "Artist A", channel_id: "UCartistA" },
												{ name: "Artist B" },
											],
											album: { name: "Album X" },
											duration: { seconds: 200 },
											thumbnails: [
												{
													url: "https://lh3.googleusercontent.com/albumx=w60-h60-l90-rj",
													width: 60,
													height: 60,
												},
												{
													url: "https://lh3.googleusercontent.com/albumx=w120-h120-l90-rj",
													width: 120,
													height: 120,
												},
											],
										},
										{ title: "No Id", artists: [{ name: "B" }] },
										{ id: "vid3", title: "Sparse" },
									],
								},
					videos:
						type !== "video"
							? undefined
							: {
									contents: [
										{
											id: "clip1",
											title: "Song One (Official Video)",
											authors: [{ name: "Artist A", channel_id: "UCartistA" }],
											duration: { seconds: 210 },
											thumbnails: [
												{
													url: "https://i.ytimg.com/vi/clip1/hqdefault.jpg",
													width: 480,
													height: 270,
												},
											],
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
				artworkUrl: "https://lh3.googleusercontent.com/albumx=w544-h544-l90-rj",
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
				artworkUrl: null,
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
				artworkUrl: null,
			},
		])
	})

	describe("edge cases", () => {
		it("returns an empty array when there are no results in either shelf", async () => {
			create.mockResolvedValue({ music: { search: async () => ({}) } })
			const { searchSongs } = await import("./innertube")
			expect(await searchSongs("nothing")).toEqual([])
		})

		it("regression: searches the song and video filters separately, since the unfiltered layout has no Songs or Videos shelf", async () => {
			const search = vi.fn(async (_query: string, { type }: { type: string }) =>
				type === "all"
					? { contents: [{ type: "ItemSection" }] }
					: type === "song"
						? {
								songs: {
									contents: [{ id: "vid1", title: "Song One", duration: { seconds: 200 } }],
								},
							}
						: { videos: { contents: [{ id: "clip1", title: "Clip", duration: { seconds: 210 } }] } }
			)
			create.mockResolvedValue({ music: { search } })
			const { searchSongs } = await import("./innertube")
			const results = await searchSongs("song one")
			expect(results.map((c) => [c.videoId, c.videoType])).toEqual([
				["vid1", "song"],
				["clip1", "video"],
			])
			expect(search.mock.calls.map(([, opts]) => opts.type).sort()).toEqual(["song", "video"])
		})

		it("keeps the songs when only the video search fails", async () => {
			create.mockResolvedValue({
				music: {
					search: async (_query: string, { type }: { type: string }) => {
						if (type === "video") throw new Error("rate limited")
						return { songs: { contents: [{ id: "vid1", title: "Song One" }] } }
					},
				},
			})
			const { searchSongs } = await import("./innertube")
			expect((await searchSongs("song one")).map((c) => c.videoId)).toEqual(["vid1"])
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
