import { createTypesafeClient } from "@/services/typesafe"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import type { SongCandidate } from "@/utils/innertube"
import { normalizeArtist, normalizeSong } from "@/utils/normalize"
import { describe, expect, it } from "vitest"
import { videoLinkRoutes } from "./video-links"

const KEY = "b".repeat(64)
const SONG = { song: "Blinding Lights", artist: "The Weeknd", duration: 200 }

function candidate(over: Partial<SongCandidate> & Pick<SongCandidate, "videoId">): SongCandidate {
	return {
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		artistChannelIds: ["UC0WP5P-ufpRfjbNrmOWwLBQ"],
		album: "After Hours",
		durationSeconds: 200,
		videoType: "song",
		artworkUrl: null,
		...over,
	}
}

const SEARCH_RESULTS = [
	candidate({
		videoId: "0YNwMWaGpEA",
		title: "Blinding Lights (Chromatics Remix)",
		album: "Blinding Lights (Chromatics Remix)",
	}),
	candidate({ videoId: "fHI8X4OXluQ" }),
	candidate({ videoId: "4NRXx6U8ABQ", videoType: "video", album: null }),
]

const SCORES: Record<string, number> = {
	"Blinding Lights": 1.84,
	"Blinding Lights (Chromatics Remix)": 0.06,
}

function queuedDb(queue: unknown[]) {
	return {
		prepare() {
			return {
				bind() {
					return {
						async first<T>() {
							return (queue.shift() as T) ?? null
						},
						async all<T>() {
							return { results: (queue.shift() as T[]) ?? [] }
						},
						async run() {
							queue.shift()
						},
					}
				},
			}
		},
	}
}

function appWith(queue: unknown[], typesafe: boolean) {
	const cache = makeMemoryCache()
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store.set(
		"session:tok",
		JSON.stringify({ keyId: KEY, issuedAt, expiresAt: issuedAt + 600 })
	)
	cache.store.set(
		`songsearch:v5:${normalizeSong(SONG.song)}|${normalizeArtist(SONG.artist)}`,
		JSON.stringify(SEARCH_RESULTS)
	)
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		const { state } = JSON.parse(String(init?.body))
		return Response.json({
			answers: { link: { type: "score", score: SCORES[state.candidate.title] } },
		})
	}) as typeof fetch
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const env = {
		DB: queuedDb([{ id: 42, key_id: KEY }, ...queue]),
		CACHE: cache,
		RATE_LIMITER: limiter,
		READ_RATE_LIMITER: limiter,
		TYPESAFE: typesafe ? createTypesafeClient({ apiKey: "k", fetch: fetchImpl }) : null,
	} as unknown as Env
	return videoLinkRoutes(env)
}

type SuggestionsBody = {
	success: boolean
	data: { suggestions: Array<{ videoId: string; match: unknown; matchScore: number }> }
}

const VARIANT_ROW = {
	submitter_id: 42,
	video_id: "dQw4w9WgXcQ",
	song: SONG.song,
	artist: SONG.artist,
	album: "After Hours",
	duration: SONG.duration,
	deleted_at: null,
}

const ownerRequest = () =>
	new Request("http://localhost/lyrics/7/suggested-videos", {
		method: "POST",
		headers: { authorization: "Bearer tok" },
	})

const songRequest = () =>
	new Request("http://localhost/lyrics/suggested-videos", {
		method: "POST",
		headers: { authorization: "Bearer tok", "content-type": "application/json" },
		body: JSON.stringify({ ...SONG, album: "After Hours" }),
	})

const EXPECTED = [
	{ videoId: "fHI8X4OXluQ", match: { level: "same", score: 1.84 } },
	{ videoId: "4NRXx6U8ABQ", match: { level: "same", score: 1.84 } },
	{ videoId: "0YNwMWaGpEA", match: { level: "different", score: 0.06 } },
]

describe("recording match on the suggestion routes", () => {
	it("POST /lyrics/:id/suggested-videos returns a match per suggestion, same first", async () => {
		const res = await appWith([VARIANT_ROW, []], true).handle(ownerRequest())
		expect(res.status).toBe(200)
		const body = (await res.json()) as SuggestionsBody
		expect(body.data.suggestions.map(({ videoId, match }) => ({ videoId, match }))).toEqual(
			EXPECTED
		)
	})

	it("POST /lyrics/suggested-videos returns a match per suggestion, same first", async () => {
		const res = await appWith([], true).handle(songRequest())
		expect(res.status).toBe(200)
		const body = (await res.json()) as SuggestionsBody
		expect(body.data.suggestions.map(({ videoId, match }) => ({ videoId, match }))).toEqual(
			EXPECTED
		)
	})

	describe("disabled", () => {
		it("serializes match as null, not a missing field, on both routes", async () => {
			for (const [queue, request] of [
				[[VARIANT_ROW, []], ownerRequest()],
				[[], songRequest()],
			] as const) {
				const res = await appWith([...queue], false).handle(request)
				const body = (await res.json()) as SuggestionsBody
				expect(body.data.suggestions).toHaveLength(3)
				for (const s of body.data.suggestions) {
					expect(s).toHaveProperty("match", null)
				}
			}
		})
	})

	describe("invariants", () => {
		it("keeps matchScore alongside match", async () => {
			const res = await appWith([], true).handle(songRequest())
			const body = (await res.json()) as SuggestionsBody
			expect(body.data.suggestions.map((s) => s.matchScore)).toEqual([1, 0.8, 0.8])
		})
	})
})
