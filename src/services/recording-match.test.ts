import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import { sha256Hex } from "@/utils/hash"
import type { SongCandidate } from "@/utils/innertube"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTypesafeJevGate } from "./jev-gate"
import {
	type LyricTrack,
	cachedRecordingMatch,
	matchLevel,
	matchSuggestions,
	recordingMatchState,
} from "./recording-match"
import { createTypesafeClient } from "./typesafe"

afterEach(() => {
	vi.restoreAllMocks()
})

const LYRIC: LyricTrack = { title: "Blinding Lights", artist: "The Weeknd" }

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

const ALBUM = candidate({ videoId: "fHI8X4OXluQ" })
const SINGLE = candidate({ videoId: "J7p4bzqLvCw", album: "Blinding Lights" })
const REMIX = candidate({
	videoId: "0YNwMWaGpEA",
	title: "Blinding Lights (Chromatics Remix)",
	album: "Blinding Lights (Chromatics Remix)",
})
const EDIT = candidate({ videoId: "Zi_XLOBDo_Y", title: "Blinding Lights (Radio Edit)" })
const MUSIC_VIDEO = candidate({
	videoId: "4NRXx6U8ABQ",
	title: "The Weeknd - Blinding Lights (Official Video)",
	album: null,
	videoType: "video",
})

type Suggestion = SongCandidate & { matchScore: number }
const suggest = (c: SongCandidate, matchScore = 1): Suggestion => ({ ...c, matchScore })

interface JevRequest {
	state: ReturnType<typeof recordingMatchState>
	model: string
	questions: Record<string, { type: string; instructions: string; criteria: string[] }>
}

type Reply = number | Response | Error | (() => Promise<Response>)

function fakeTypesafe(reply: (request: JevRequest) => Reply) {
	const requests: Array<{ body: JevRequest; init: RequestInit }> = []
	const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as JevRequest
		requests.push({ body, init: init ?? {} })
		const answer = reply(body)
		if (answer instanceof Error) throw answer
		if (answer instanceof Response) return answer
		if (typeof answer === "function") return answer()
		return Response.json({
			model: "jev-1.13.0",
			answers: { link: { type: "score", score: answer, confidence: 0.8 } },
			usage: { input_tokens: 480, output_tokens: 3 },
		})
	}
	return { requests, fetchImpl: fetchImpl as typeof fetch }
}

const SCORES: Record<string, number> = {
	[ALBUM.videoId]: 1.9,
	[SINGLE.videoId]: 1.76,
	[REMIX.videoId]: 0.04,
	[EDIT.videoId]: 0.98,
	[MUSIC_VIDEO.videoId]: 1.71,
}

function scoreByCandidate(overrides: Record<string, Reply> = {}) {
	const byTitle = new Map(
		[ALBUM, SINGLE, REMIX, EDIT, MUSIC_VIDEO].map((c) => [`${c.title}|${c.album}`, c.videoId])
	)
	return (request: JevRequest): Reply => {
		const id = byTitle.get(`${request.state.candidate.title}|${request.state.candidate.album}`)
		if (id === undefined) throw new Error("unexpected candidate")
		return overrides[id] ?? SCORES[id]
	}
}

function countingLimiter(allow = Number.POSITIVE_INFINITY) {
	const calls: Array<{ key: string; maxRequests?: number; windowSeconds?: number }> = []
	const counts = new Map<string, number>()
	return {
		calls,
		async limit(opts: { key: string; maxRequests?: number; windowSeconds?: number }) {
			calls.push(opts)
			const count = (counts.get(opts.key) ?? 0) + 1
			counts.set(opts.key, count)
			return { success: count <= Math.min(allow, opts.maxRequests ?? 10) }
		},
	}
}

function envWith(fetchImpl?: typeof fetch, cache = makeMemoryCache(), limiter = countingLimiter()) {
	const env = {
		CACHE: cache,
		RATE_LIMITER: limiter,
		TYPESAFE: fetchImpl ? createTypesafeClient({ apiKey: "ts-key", fetch: fetchImpl }) : null,
	} as unknown as Env
	return { env, cache, limiter }
}

function cacheKey(lyric: LyricTrack, c: SongCandidate): string {
	return `recmatch:v1:${sha256Hex(JSON.stringify(recordingMatchState(lyric, c)))}`
}

describe("matchLevel", () => {
	it("maps a score to the nearest level", () => {
		expect(matchLevel(0)).toBe("different")
		expect(matchLevel(1)).toBe("related")
		expect(matchLevel(2)).toBe("same")
	})

	describe("edge cases", () => {
		it.each([
			[0.49, "different"],
			[0.5, "related"],
			[1.49, "related"],
			[1.5, "same"],
		] as const)("maps %s to %s", (score, level) => {
			expect(matchLevel(score)).toBe(level)
		})
	})
})

describe("recordingMatchState", () => {
	it("describes the lyric track and the candidate recording", () => {
		expect(recordingMatchState(LYRIC, ALBUM)).toEqual({
			lyric_track: { title: "Blinding Lights", artist: "The Weeknd" },
			candidate: {
				title: "Blinding Lights",
				artists: ["The Weeknd"],
				album: "After Hours",
				kind: "audio track",
			},
		})
	})

	it("calls a video-type candidate a video upload", () => {
		expect(recordingMatchState(LYRIC, MUSIC_VIDEO).candidate.kind).toBe("video upload")
	})

	describe("edge cases", () => {
		it("keeps the raw lyric title, version tag, case and all", () => {
			const lyric = { title: "BLINDING LIGHTS (Chromatics Remix) ", artist: "The Weeknd" }
			expect(recordingMatchState(lyric, REMIX).lyric_track.title).toBe(
				"BLINDING LIGHTS (Chromatics Remix) "
			)
		})

		it("passes a missing album as null", () => {
			expect(recordingMatchState(LYRIC, MUSIC_VIDEO).candidate.album).toBeNull()
		})

		it("keeps every credited artist in order", () => {
			const collab = candidate({ videoId: "collab00001", artists: ["The Weeknd", "Rosalía"] })
			expect(recordingMatchState(LYRIC, collab).candidate.artists).toEqual([
				"The Weeknd",
				"Rosalía",
			])
		})
	})

	describe("invariants", () => {
		it("leaves ids, durations, artwork and scores out of the state", () => {
			const state = JSON.stringify(recordingMatchState({ ...LYRIC, lyricsId: 42 }, ALBUM))
			for (const leaked of [
				ALBUM.videoId,
				"UC0WP5P-ufpRfjbNrmOWwLBQ",
				"200",
				"42",
				"durationSeconds",
				"matchScore",
			]) {
				expect(state).not.toContain(leaked)
			}
		})
	})
})

describe("matchSuggestions", () => {
	it("asks Jev the recording question once per candidate", async () => {
		const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		await matchSuggestions(env, LYRIC, [suggest(ALBUM)])

		expect(requests).toHaveLength(1)
		const [{ body, init }] = requests
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer ts-key")
		expect(body.model).toBe("jev-latest")
		expect(body.state).toEqual(recordingMatchState(LYRIC, ALBUM))
		expect(body.questions).toEqual({
			link: {
				type: "score",
				instructions: "How do `lyric_track` and `candidate` relate as recordings?",
				criteria: [
					"Different recordings: another song, or an alternate version such as a remix, live, acoustic, instrumental, sped up, re-recorded or other-language version.",
					"Closely related, may or may not be the same recording: an edit, a variant, or a title that could name either.",
					"The same recording, only a different upload or release of it, such as another album, deluxe edition, single or compilation, or a title that only adds credits for the same performers.",
				],
			},
		})
	})

	it("attaches the level and raw score to every suggestion", async () => {
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		const out = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(EDIT, 0.8)])
		expect(out).toEqual([
			{ ...suggest(ALBUM), match: { level: "same", score: 1.9 } },
			{ ...suggest(EDIT, 0.8), match: { level: "related", score: 0.98 } },
		])
	})

	it("orders same, then related, then unjudged, then different", async () => {
		const { fetchImpl } = fakeTypesafe(
			scoreByCandidate({ [MUSIC_VIDEO.videoId]: new Response("busy", { status: 429 }) })
		)
		const { env } = envWith(fetchImpl)
		const out = await matchSuggestions(env, LYRIC, [
			suggest(REMIX),
			suggest(MUSIC_VIDEO),
			suggest(EDIT),
			suggest(ALBUM),
		])
		expect(out.map((s) => [s.videoId, s.match?.level ?? null])).toEqual([
			[ALBUM.videoId, "same"],
			[EDIT.videoId, "related"],
			[MUSIC_VIDEO.videoId, null],
			[REMIX.videoId, "different"],
		])
	})

	it("keeps the incoming order within a level", async () => {
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		const out = await matchSuggestions(env, LYRIC, [
			suggest(SINGLE),
			suggest(REMIX),
			suggest(MUSIC_VIDEO),
			suggest(ALBUM),
		])
		expect(out.map((s) => s.videoId)).toEqual([
			SINGLE.videoId,
			MUSIC_VIDEO.videoId,
			ALBUM.videoId,
			REMIX.videoId,
		])
	})

	it("caches a successful answer for 30 days under the versioned state hash", async () => {
		const puts: Array<{ key: string; value: string; ttl?: number }> = []
		const cache = makeMemoryCache()
		const put = cache.put
		cache.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			puts.push({ key, value, ttl: opts?.expirationTtl })
			await put(key, value)
		}
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl, cache)
		await matchSuggestions(env, LYRIC, [suggest(ALBUM)])

		expect(puts).toHaveLength(1)
		expect(puts[0].key).toBe(cacheKey(LYRIC, ALBUM))
		expect(puts[0].key).toMatch(/^recmatch:v1:[0-9a-f]{64}$/)
		expect(puts[0].ttl).toBe(60 * 60 * 24 * 30)
		expect(config.videoLinking.recordingMatch.cacheTtlSeconds).toBe(60 * 60 * 24 * 30)
	})

	it("serves a cached answer without calling TypeSafe", async () => {
		const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
		expect(requests).toHaveLength(2)

		const again = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
		expect(requests).toHaveLength(2)
		expect(again.map((s) => s.match)).toEqual([
			{ level: "same", score: 1.9 },
			{ level: "different", score: 0.04 },
		])
	})

	describe("capacity", () => {
		const many = Array.from({ length: 12 }, (_, i) =>
			suggest(
				candidate({
					videoId: `vid${String(i).padStart(8, "0")}`,
					album: `After Hours ${i}`,
				}),
				1 - i / 100
			)
		)

		it("judges at most 10 candidates and leaves the rest unjudged", async () => {
			const { requests, fetchImpl } = fakeTypesafe(() => 1.9)
			const { env } = envWith(fetchImpl)
			const out = await matchSuggestions(env, LYRIC, many)

			expect(config.videoLinking.recordingMatch.maxCandidates).toBe(10)
			expect(requests).toHaveLength(10)
			expect(requests.map((r) => r.body.state.candidate.album)).toEqual(
				many.slice(0, 10).map((s) => s.album)
			)
			expect(out.slice(0, 10).every((s) => s.match?.level === "same")).toBe(true)
			expect(out.slice(10).map((s) => [s.videoId, s.match])).toEqual([
				[many[10].videoId, null],
				[many[11].videoId, null],
			])
		})

		it("sorts unjudged rows past the cap ahead of different ones", async () => {
			const { fetchImpl } = fakeTypesafe(() => 0.1)
			const { env } = envWith(fetchImpl)
			const out = await matchSuggestions(env, LYRIC, many)
			expect(out.slice(0, 2).map((s) => s.videoId)).toEqual([many[10].videoId, many[11].videoId])
		})

		it("runs no more than 5 requests at once", async () => {
			let inFlight = 0
			let peak = 0
			const { fetchImpl } = fakeTypesafe(() => async () => {
				inFlight++
				peak = Math.max(peak, inFlight)
				await new Promise((resolve) => setTimeout(resolve, 5))
				inFlight--
				return Response.json({ answers: { link: { type: "score", score: 2 } } })
			})
			const { env } = envWith(fetchImpl)
			await matchSuggestions(env, LYRIC, many)
			expect(config.videoLinking.recordingMatch.concurrency).toBe(5)
			expect(peak).toBe(5)
		})

		it("gives each request the 1.5 s timeout signal", async () => {
			const timeout = vi.spyOn(AbortSignal, "timeout")
			const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
			expect(timeout.mock.calls).toEqual([[1500], [1500]])
			expect(requests.every((r) => r.init.signal instanceof AbortSignal)).toBe(true)
		})
	})

	describe("edge cases", () => {
		it("returns [] for no suggestions without calling TypeSafe", async () => {
			const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			expect(await matchSuggestions(env, LYRIC, [])).toEqual([])
			expect(requests).toHaveLength(0)
		})

		it("judges a single suggestion", async () => {
			const { fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			const [only] = await matchSuggestions(env, LYRIC, [suggest(REMIX)])
			expect(only.match).toEqual({ level: "different", score: 0.04 })
		})

		it("accepts the ends of the score range", async () => {
			const { fetchImpl } = fakeTypesafe(
				scoreByCandidate({ [ALBUM.videoId]: 2, [REMIX.videoId]: 0 })
			)
			const { env } = envWith(fetchImpl)
			const out = await matchSuggestions(env, LYRIC, [suggest(REMIX), suggest(ALBUM)])
			expect(out.map((s) => s.match)).toEqual([
				{ level: "same", score: 2 },
				{ level: "different", score: 0 },
			])
		})
	})

	describe("disabled", () => {
		it("leaves every match null and keeps the order when no key is configured", async () => {
			const { env } = envWith()
			const input = [suggest(REMIX), suggest(ALBUM), suggest(EDIT)]
			const out = await matchSuggestions(env, LYRIC, input)
			expect(out).toEqual(input.map((s) => ({ ...s, match: null })))
		})

		it("does not read a cached answer when disabled", async () => {
			const { fetchImpl } = fakeTypesafe(scoreByCandidate())
			const cache = makeMemoryCache()
			await matchSuggestions(envWith(fetchImpl, cache).env, LYRIC, [suggest(ALBUM)])
			const [out] = await matchSuggestions(envWith(undefined, cache).env, LYRIC, [suggest(ALBUM)])
			expect(out.match).toBeNull()
		})
	})

	describe("error paths", () => {
		const failures: Array<[string, Reply]> = [
			["a timeout", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
			["a 429", new Response("slow down", { status: 429 })],
			["a 500", new Response("boom", { status: 500 })],
			["a score above the top level", 2.4],
			["a negative score", -0.2],
			[
				"a missing score",
				new Response(JSON.stringify({ answers: { link: { type: "score" } } }), { status: 200 }),
			],
			["a response without answers", Response.json({ usage: {} })],
		]

		for (const [label, reply] of failures) {
			it(`leaves only the failing row unjudged on ${label}`, async () => {
				const warn = vi.spyOn(Logger.prototype, "warn")
				const { fetchImpl } = fakeTypesafe(scoreByCandidate({ [EDIT.videoId]: reply }))
				const { env, cache } = envWith(fetchImpl)
				const out = await matchSuggestions(env, { ...LYRIC, lyricsId: 42 }, [
					suggest(EDIT),
					suggest(ALBUM),
					suggest(REMIX),
				])

				expect(out.map((s) => [s.videoId, s.match])).toEqual([
					[ALBUM.videoId, { level: "same", score: 1.9 }],
					[EDIT.videoId, null],
					[REMIX.videoId, { level: "different", score: 0.04 }],
				])
				expect(warn).toHaveBeenCalledWith(
					"recording match failed, leaving the suggestion unjudged",
					expect.objectContaining({
						lyricsId: 42,
						videoId: EDIT.videoId,
						error: expect.any(String),
					})
				)
				expect(cache.store.has(cacheKey(LYRIC, EDIT))).toBe(false)
			})
		}

		it("asks again after a failure because failures are not cached", async () => {
			let fail = true
			const { requests, fetchImpl } = fakeTypesafe(() =>
				fail ? new Response("boom", { status: 500 }) : 1.9
			)
			const { env, cache } = envWith(fetchImpl)
			const [first] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(first.match).toBeNull()
			expect([...cache.store.keys()].some((k) => k.startsWith("recmatch:"))).toBe(false)

			fail = false
			const [second] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(second.match).toEqual({ level: "same", score: 1.9 })
			expect(requests).toHaveLength(2)
		})

		it("never rejects even when every candidate fails", async () => {
			const { fetchImpl } = fakeTypesafe(() => new Error("socket hang up"))
			const { env } = envWith(fetchImpl)
			const out = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
			expect(out.map((s) => s.match)).toEqual([null, null])
		})

		it("asks again when the cached entry is corrupt", async () => {
			const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env, cache } = envWith(fetchImpl)
			cache.store.set(cacheKey(LYRIC, ALBUM), "{not json")
			const [out] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(out.match).toEqual({ level: "same", score: 1.9 })
			expect(requests).toHaveLength(1)
		})

		it("asks again when the cached score is out of range", async () => {
			const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env, cache } = envWith(fetchImpl)
			cache.store.set(cacheKey(LYRIC, ALBUM), JSON.stringify({ score: 7 }))
			const [out] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(out.match).toEqual({ level: "same", score: 1.9 })
			expect(requests).toHaveLength(1)
		})
	})

	describe("invariants", () => {
		it("returns every suggestion exactly once", async () => {
			const { fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			const input = [suggest(REMIX), suggest(MUSIC_VIDEO), suggest(EDIT), suggest(ALBUM)]
			const out = await matchSuggestions(env, LYRIC, input)
			expect(out.map((s) => s.videoId).sort()).toEqual(input.map((s) => s.videoId).sort())
		})

		it("does not mutate its input", async () => {
			const { fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			const input = [suggest(REMIX), suggest(ALBUM)]
			const snapshot = JSON.stringify(input)
			await matchSuggestions(env, LYRIC, input)
			expect(JSON.stringify(input)).toBe(snapshot)
		})

		it("keeps each match paired with its own suggestion after reordering", async () => {
			const { fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			const out = await matchSuggestions(env, LYRIC, [
				suggest(REMIX, 0.3),
				suggest(EDIT, 0.5),
				suggest(ALBUM, 1),
			])
			for (const s of out) {
				expect(s.match?.score).toBe(SCORES[s.videoId])
			}
			expect(out.map((s) => [s.videoId, s.matchScore])).toEqual([
				[ALBUM.videoId, 1],
				[EDIT.videoId, 0.5],
				[REMIX.videoId, 0.3],
			])
		})
	})

	describe("regressions", () => {
		it("regression: a cached answer for one lyric title is not reused for another", async () => {
			const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
			const { env } = envWith(fetchImpl)
			await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			await matchSuggestions(env, { title: "Blinding Lights (Live)", artist: "The Weeknd" }, [
				suggest(ALBUM),
			])
			expect(requests).toHaveLength(2)
		})
	})
})

describe("budget", () => {
	it("spends one global budget slot per uncached call, with the configured limits", async () => {
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env, limiter } = envWith(fetchImpl)
		await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
		expect(config.videoLinking.recordingMatch.budget).toEqual({
			maxRequests: 300,
			windowSeconds: 60,
		})
		expect(limiter.calls).toEqual([
			{ key: "recmatch:budget", maxRequests: 300, windowSeconds: 60 },
			{ key: "recmatch:budget", maxRequests: 300, windowSeconds: 60 },
		])
	})

	it("leaves rows unjudged without calling TypeSafe once the budget is spent", async () => {
		const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env, cache } = envWith(fetchImpl, makeMemoryCache(), countingLimiter(1))
		const out = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX), suggest(EDIT)])
		expect(requests).toHaveLength(1)
		expect(out.filter((s) => s.match === null)).toHaveLength(2)
		expect([...cache.store.keys()].filter((k) => k.startsWith("recmatch:v1:"))).toHaveLength(1)
	})

	it("serves cache hits without spending budget", async () => {
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const cache = makeMemoryCache()
		await matchSuggestions(envWith(fetchImpl, cache).env, LYRIC, [suggest(ALBUM)])

		const limiter = countingLimiter(0)
		const [out] = await matchSuggestions(envWith(fetchImpl, cache, limiter).env, LYRIC, [
			suggest(ALBUM),
		])
		expect(out.match).toEqual({ level: "same", score: 1.9 })
		expect(limiter.calls).toHaveLength(0)
	})

	it("spends nothing when matching is disabled", async () => {
		const { env, limiter } = envWith()
		await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
		expect(limiter.calls).toHaveLength(0)
	})
})

describe("breaker", () => {
	const tripping: Array<[string, Reply]> = [
		["a 429", new Response("slow down", { status: 429 })],
		["a 529", new Response("overloaded", { status: 529 })],
		["a timeout", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
	]

	for (const [label, reply] of tripping) {
		it(`stops calling TypeSafe for the breaker window after ${label}`, async () => {
			const puts: Array<{ key: string; ttl?: number }> = []
			const cache = makeMemoryCache()
			const put = cache.put
			cache.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
				puts.push({ key, ttl: opts?.expirationTtl })
				await put(key, value)
			}
			let calls = 0
			const { fetchImpl } = fakeTypesafe(() => {
				calls++
				return calls === 1 ? reply : 1.9
			})
			const { env, limiter } = envWith(fetchImpl, cache)
			const [first] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(first.match).toBeNull()
			expect(puts).toEqual([{ key: "recmatch:breaker", ttl: 30 }])
			expect(config.videoLinking.recordingMatch.breakerSeconds).toBe(30)

			const budgetBefore = limiter.calls.length
			const out = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
			expect(out.map((s) => s.match)).toEqual([null, null])
			expect(calls).toBe(1)
			expect(limiter.calls).toHaveLength(budgetBefore)
		})
	}

	for (const [label, reply] of [
		["a 500", new Response("boom", { status: 500 })],
		["a malformed score", 2.4],
		["a network error", new Error("socket hang up")],
	] as Array<[string, Reply]>) {
		it(`stays closed after ${label}`, async () => {
			let calls = 0
			const { fetchImpl } = fakeTypesafe(() => {
				calls++
				return calls === 1 ? reply : 1.9
			})
			const { env, cache } = envWith(fetchImpl)
			await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(cache.store.has("recmatch:breaker")).toBe(false)
			const [again] = await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(again.match).toEqual({ level: "same", score: 1.9 })
			expect(calls).toBe(2)
		})
	}

	it("still serves cached answers while open", async () => {
		const { fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env, cache } = envWith(fetchImpl)
		await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
		cache.store.set("recmatch:breaker", "1")
		const out = await matchSuggestions(env, LYRIC, [suggest(ALBUM), suggest(REMIX)])
		expect(out.map((s) => [s.videoId, s.match])).toEqual([
			[ALBUM.videoId, { level: "same", score: 1.9 }],
			[REMIX.videoId, null],
		])
	})

	it("logs once when it opens", async () => {
		const warn = vi.spyOn(Logger.prototype, "warn")
		const { fetchImpl } = fakeTypesafe(() => new Response("slow down", { status: 429 }))
		const { env } = envWith(fetchImpl)
		await matchSuggestions(env, { ...LYRIC, lyricsId: 42 }, [suggest(ALBUM)])
		expect(warn).toHaveBeenCalledWith(
			"recording match backing off from TypeSafe",
			expect.objectContaining({ lyricsId: 42, videoId: ALBUM.videoId, seconds: 30 })
		)
	})

	describe("invariants", () => {
		it("never touches the Jev revision gate", async () => {
			const { fetchImpl } = fakeTypesafe(() => new Response("slow down", { status: 429 }))
			const { env, cache } = envWith(fetchImpl)
			await matchSuggestions(env, LYRIC, [suggest(ALBUM)])
			expect(cache.store.has("recmatch:breaker")).toBe(true)

			let gateCalls = 0
			const gateFetch = (async () => {
				gateCalls++
				return Response.json({
					answers: Object.fromEntries(
						[
							"offensive_insertion",
							"unrelated_content",
							"deliberate_corruption",
							"section_removal",
						].map((id) => [id, { type: "noul", noul: 0.1 }])
					),
				})
			}) as typeof fetch
			const verdict = await createTypesafeJevGate({ apiKey: "k", fetch: gateFetch }).check({
				lyricsId: 1,
				song: "Blinding Lights",
				artist: "The Weeknd",
				diff: "-a\n+b",
				lyrics: "a\n",
			})
			expect(gateCalls).toBe(1)
			expect(verdict).toEqual({ flagged: false, probability: 0.1 })
		})
	})
})

describe("cachedRecordingMatch", () => {
	it("returns the cached match for a lyric and candidate without calling TypeSafe", async () => {
		const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		await matchSuggestions(env, LYRIC, [suggest(EDIT)])
		expect(await cachedRecordingMatch(env, LYRIC, EDIT)).toEqual({ level: "related", score: 0.98 })
		expect(requests).toHaveLength(1)
	})

	it("returns null when nothing is cached, without calling TypeSafe", async () => {
		const { requests, fetchImpl } = fakeTypesafe(scoreByCandidate())
		const { env } = envWith(fetchImpl)
		expect(await cachedRecordingMatch(env, LYRIC, ALBUM)).toBeNull()
		expect(requests).toHaveLength(0)
	})

	it("returns null for a corrupt entry", async () => {
		const { env, cache } = envWith()
		cache.store.set(cacheKey(LYRIC, ALBUM), "{not json")
		expect(await cachedRecordingMatch(env, LYRIC, ALBUM)).toBeNull()
	})
})
