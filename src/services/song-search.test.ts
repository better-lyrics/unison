import { config } from "@/config"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { SongCandidate } from "@/utils/innertube"
import { describe, expect, it, vi } from "vitest"
import { cachedSongSearch, findSongCandidate } from "./song-search"

const SONG = { song: "Blinding Lights", artist: "The Weeknd" }
const KEY = "songsearch:v5:blinding lights|the weeknd"

function makeEnv() {
	const cache = makeMemoryCache()
	const ttls = new Map<string, number | undefined>()
	const CACHE = {
		...cache,
		async put(key: string, value: string, opts?: { expirationTtl?: number }) {
			ttls.set(key, opts?.expirationTtl)
			await cache.put(key, value)
		},
	}
	return { env: { CACHE } as unknown as Env, store: cache.store, ttlOf: (k: string) => ttls.get(k) }
}

function candidate(over: Partial<SongCandidate> & Pick<SongCandidate, "videoId">): SongCandidate {
	return {
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		artistChannelIds: ["UCweeknd"],
		album: "After Hours",
		durationSeconds: 200,
		videoType: "song",
		artworkUrl: "https://lh3.googleusercontent.com/after=w544-h544-l90-rj",
		...over,
	}
}

describe("cachedSongSearch", () => {
	it("searches song and artist together and caches the result", async () => {
		const { env, store, ttlOf } = makeEnv()
		const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
		const out = await cachedSongSearch(env, SONG, search)
		expect(out.map((c) => c.videoId)).toEqual(["fHI8X4OXluQ"])
		expect(search).toHaveBeenCalledWith("Blinding Lights The Weeknd")
		expect(JSON.parse(store.get(KEY) as string)).toEqual(out)
		expect(ttlOf(KEY)).toBe(config.videoLinking.suggestionCacheTtlSeconds)
	})

	it("serves a cached result without searching again", async () => {
		const { env } = makeEnv()
		const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
		await cachedSongSearch(env, SONG, search)
		const again = await cachedSongSearch(env, SONG, search)
		expect(again.map((c) => c.videoId)).toEqual(["fHI8X4OXluQ"])
		expect(search).toHaveBeenCalledTimes(1)
	})

	describe("edge cases", () => {
		it("caches an empty result for the shorter empty ttl", async () => {
			const { env, ttlOf } = makeEnv()
			expect(await cachedSongSearch(env, SONG, async () => [])).toEqual([])
			expect(ttlOf(KEY)).toBe(config.videoLinking.emptySuggestionCacheTtlSeconds)
		})

		it("shares one cache entry across spellings that normalize the same", async () => {
			const { env } = makeEnv()
			const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
			await cachedSongSearch(env, SONG, search)
			await cachedSongSearch(env, { song: "  BLINDING LIGHTS ", artist: "the weeknd" }, search)
			expect(search).toHaveBeenCalledTimes(1)
		})
	})

	describe("error paths", () => {
		it("drops a corrupt cache entry and searches again", async () => {
			const { env, store } = makeEnv()
			store.set(KEY, "{not json")
			const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
			const out = await cachedSongSearch(env, SONG, search)
			expect(out.map((c) => c.videoId)).toEqual(["fHI8X4OXluQ"])
			expect(search).toHaveBeenCalledTimes(1)
		})
	})

	describe("regressions", () => {
		it("regression: ignores v4 entries, which predate artwork on candidates", async () => {
			const { env, store } = makeEnv()
			store.set(
				"songsearch:v4:blinding lights|the weeknd",
				JSON.stringify([{ videoId: "stale000000" }])
			)
			const out = await cachedSongSearch(env, SONG, async () => [
				candidate({ videoId: "fHI8X4OXluQ" }),
			])
			expect(out.map((c) => c.videoId)).toEqual(["fHI8X4OXluQ"])
		})
	})
})

describe("findSongCandidate", () => {
	it("returns the search result whose video id matches", async () => {
		const { env } = makeEnv()
		const search = async () => [
			candidate({ videoId: "4NRXx6U8ABQ", videoType: "video", artworkUrl: null }),
			candidate({ videoId: "fHI8X4OXluQ" }),
		]
		const found = await findSongCandidate(env, SONG, "fHI8X4OXluQ", search)
		expect(found?.videoId).toBe("fHI8X4OXluQ")
		expect(found?.durationSeconds).toBe(200)
	})

	describe("edge cases", () => {
		it("returns null when the id is not among the results", async () => {
			const { env } = makeEnv()
			const search = async () => [candidate({ videoId: "fHI8X4OXluQ" })]
			expect(await findSongCandidate(env, SONG, "dQw4w9WgXcQ", search)).toBeNull()
		})

		it("returns null when the search finds nothing", async () => {
			const { env } = makeEnv()
			expect(await findSongCandidate(env, SONG, "dQw4w9WgXcQ", async () => [])).toBeNull()
		})
	})

	describe("invariants", () => {
		it("reuses the cached search, so verification and suggestions cost one search per song", async () => {
			const { env } = makeEnv()
			const search = vi.fn(async () => [candidate({ videoId: "fHI8X4OXluQ" })])
			await cachedSongSearch(env, SONG, search)
			await findSongCandidate(env, SONG, "fHI8X4OXluQ", search)
			expect(search).toHaveBeenCalledTimes(1)
		})
	})
})
