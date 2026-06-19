import type { Env, LyricsRow } from "@/types"
import { hashBucket } from "@/utils/exploration"
import { describe, expect, it } from "vitest"
import { lyricsRoutes } from "./lyrics"

interface DBCall {
	sql: string
	params: unknown[]
}

function makeMockDB(queue: unknown[] = []) {
	const calls: DBCall[] = []
	const db = {
		calls,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							return (queue.shift() as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							return { results: (queue.shift() as T[]) ?? [] }
						},
						async run(): Promise<void> {
							calls.push({ sql, params: args })
							queue.shift()
						},
					}
				},
			}
		},
	}
	return db
}

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(seed))
	return {
		async get(key: string) {
			return store.get(key) ?? null
		},
		async put(key: string, value: string) {
			store.set(key, value)
		},
		async delete(key: string) {
			store.delete(key)
		},
		async keys() {
			return []
		},
		async setNX() {
			return true
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>, cache: ReturnType<typeof makeMockCache>): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

const VIDEO_ID = "dQw4w9WgXcQ"
const EXPLORE_KEY = "k1"
const CONTROL_KEY = "abc"

function makeLyricsRow(overrides: Partial<LyricsRow> = {}): LyricsRow {
	return {
		id: 1,
		video_id: VIDEO_ID,
		song: "Song",
		artist: "Artist",
		album: null,
		isrc: null,
		duration: 200,
		song_norm: "song",
		artist_norm: "artist",
		album_norm: null,
		lyrics: "plain body",
		format: "plain",
		language: null,
		sync_type: "plain",
		score: 0,
		upvotes: 0,
		downvotes: 0,
		effective_score: 0,
		vote_count: 0,
		diversity_bonus: 1,
		confidence: "low",
		lyrics_text_search: null,
		score_updated_at: null,
		created_at: 1700000000,
		updated_at: 1700000000,
		submitter_id: null,
		submitter_key_id: null,
		submitter_reputation: null,
		submitter_nickname: null,
		deleted_at: null,
		deleted_by_user_id: null,
		deleted_by_role: null,
		deletion_reason: null,
		...overrides,
	}
}

function seedPrimary(cache: ReturnType<typeof makeMockCache>, primary: LyricsRow) {
	cache.put(`v:${primary.video_id}`, JSON.stringify(primary))
}

interface LyricsGetBody {
	success: boolean
	data: { id: number; videoId: string; userVote: 1 | -1 | null }
}

describe("GET /lyrics epsilon exploration threading", () => {
	it("preconditions: explore key buckets below low-tier epsilon, control key does not", () => {
		expect(hashBucket(EXPLORE_KEY, VIDEO_ID)).toBeLessThan(0.3)
		expect(hashBucket(CONTROL_KEY, VIDEO_ID)).toBeGreaterThanOrEqual(0.3)
	})

	it("serves a challenger when the caller key buckets into the explore window", async () => {
		const primary = makeLyricsRow({ id: 1, confidence: "low", sync_type: "plain" })
		const challenger = makeLyricsRow({ id: 2, sync_type: "plain", vote_count: 0 })
		const cache = makeMockCache()
		seedPrimary(cache, primary)
		const db = makeMockDB([null, [challenger], null])
		const app = lyricsRoutes(makeEnv(db, cache))

		const res = await app.handle(
			new Request(`http://localhost/lyrics?v=${VIDEO_ID}`, {
				headers: { "x-key-id": EXPLORE_KEY },
			})
		)
		const body = (await res.json()) as LyricsGetBody

		expect(res.status).toBe(200)
		expect(body.success).toBe(true)
		expect(body.data.id).toBe(challenger.id)
		expect(body.data.videoId).toBe(VIDEO_ID)
	})

	it("serves the primary unchanged when no x-key-id header is present", async () => {
		const primary = makeLyricsRow({ id: 1, confidence: "low", sync_type: "plain" })
		const challenger = makeLyricsRow({ id: 2, sync_type: "plain", vote_count: 0 })
		const cache = makeMockCache()
		seedPrimary(cache, primary)
		const db = makeMockDB([[challenger], null])
		const app = lyricsRoutes(makeEnv(db, cache))

		const res = await app.handle(new Request(`http://localhost/lyrics?v=${VIDEO_ID}`))
		const body = (await res.json()) as LyricsGetBody

		expect(res.status).toBe(200)
		expect(body.data.id).toBe(primary.id)
	})

	it("serves the primary when the caller key buckets outside the explore window", async () => {
		const primary = makeLyricsRow({ id: 1, confidence: "low", sync_type: "plain" })
		const challenger = makeLyricsRow({ id: 2, sync_type: "plain", vote_count: 0 })
		const cache = makeMockCache()
		seedPrimary(cache, primary)
		const db = makeMockDB([null, [challenger], null])
		const app = lyricsRoutes(makeEnv(db, cache))

		const res = await app.handle(
			new Request(`http://localhost/lyrics?v=${VIDEO_ID}`, {
				headers: { "x-key-id": CONTROL_KEY },
			})
		)
		const body = (await res.json()) as LyricsGetBody

		expect(res.status).toBe(200)
		expect(body.data.id).toBe(primary.id)
	})

	it("reflects the served arm in the response payload, not the incumbent", async () => {
		const primary = makeLyricsRow({ id: 1, song: "Primary Song", confidence: "low" })
		const challenger = makeLyricsRow({ id: 2, song: "Challenger Song", sync_type: "plain" })
		const cache = makeMockCache()
		seedPrimary(cache, primary)
		const db = makeMockDB([null, [challenger], null])
		const app = lyricsRoutes(makeEnv(db, cache))

		const res = await app.handle(
			new Request(`http://localhost/lyrics?v=${VIDEO_ID}`, {
				headers: { "x-key-id": EXPLORE_KEY },
			})
		)
		const body = (await res.json()) as { data: { id: number; song: string } }

		expect(body.data.id).toBe(challenger.id)
		expect(body.data.song).toBe(challenger.song)
	})
})
