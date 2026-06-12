import { config } from "@/config"
import { Logger } from "@/infra/logger"
import type { Env, LyricsRow, LyricsSearchResult, LyricsSubmission } from "@/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	findBySongArtist,
	findByVideoId,
	findVariantsByVideoId,
	getLyricsById,
	invalidateCacheAfterDelete,
	invalidateCacheForSubmitter,
	searchByQuery,
	searchBySongArtist,
	softDeleteLyrics,
	submitLyrics,
} from "./lyrics"
import { AUTO_HIDE_PREDICATE, RANKING_EXPR, RANKING_EXPR_JOINED } from "./predicates"

// -- Mocks -----------------------------------------------------------------

type Recorded = { sql: string; params: unknown[] }

interface MockDB {
	calls: Recorded[]
	queue: unknown[]
	transactionCount: number
	prepare(sql: string): {
		bind(...args: unknown[]): {
			first<T>(): Promise<T | null>
			all<T>(): Promise<{ results: T[] }>
			run(): Promise<void>
		}
	}
	transaction<T>(fn: (tx: MockDB) => Promise<T>): Promise<T>
}

function createMockDB(queue: unknown[] = []): MockDB {
	const calls: Recorded[] = []
	const db: MockDB = {
		calls,
		queue,
		transactionCount: 0,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return (next as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							const next = queue.shift()
							return { results: (next as T[]) ?? [] }
						},
						async run(): Promise<void> {
							calls.push({ sql, params: args })
							queue.shift()
						},
					}
				},
			}
		},
		async transaction<T>(fn: (tx: MockDB) => Promise<T>): Promise<T> {
			db.transactionCount++
			return fn(db)
		},
	}
	return db
}

interface MockCache {
	store: Map<string, string>
	getCalls: string[]
	putCalls: { key: string; value: string }[]
	deleteCalls: string[]
	keysCalls: string[]
	get(key: string): Promise<string | null>
	put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
	delete(key: string): Promise<void>
	keys(pattern: string): Promise<string[]>
}

function createMockCache(initial: Record<string, string> = {}): MockCache {
	const store = new Map(Object.entries(initial))
	const getCalls: string[] = []
	const putCalls: { key: string; value: string }[] = []
	const deleteCalls: string[] = []
	const keysCalls: string[] = []

	return {
		store,
		getCalls,
		putCalls,
		deleteCalls,
		keysCalls,
		async get(key: string) {
			getCalls.push(key)
			return store.get(key) ?? null
		},
		async put(key: string, value: string) {
			putCalls.push({ key, value })
			store.set(key, value)
		},
		async delete(key: string) {
			deleteCalls.push(key)
			store.delete(key)
		},
		async keys(pattern: string) {
			keysCalls.push(pattern)
			const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`)
			return [...store.keys()].filter((k) => re.test(k))
		},
	}
}

function createEnv(db: MockDB, cache: MockCache): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: {} as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
	}
}

// Plaintext lyrics (not gzip-base64): isCompressed() returns false
const SAMPLE_LYRICS = "[00:00.00] Hello world"

const baseRow: LyricsRow = {
	id: 1,
	video_id: "vid123",
	song: "Song",
	artist: "Artist",
	album: null,
	isrc: null,
	duration: 200,
	song_norm: "song",
	artist_norm: "artist",
	album_norm: null,
	lyrics: SAMPLE_LYRICS,
	format: "lrc",
	language: null,
	sync_type: "linesync",
	score: 0,
	upvotes: 0,
	downvotes: 0,
	effective_score: 0,
	vote_count: 0,
	diversity_bonus: 0,
	confidence: "low",
	lyrics_text_search: null,
	score_updated_at: null,
	created_at: 1700000000,
	updated_at: 1700000000,
	submitter_id: null,
	deleted_at: null,
	deleted_by_user_id: null,
	deleted_by_role: null,
	deletion_reason: null,
}

// -- Tests -----------------------------------------------------------------

describe("findByVideoId", () => {
	beforeEach(() => {
		// Each test uses a fresh env, but the cache.ts module caches prepared
		// statement sql substrings; nothing to reset on the module side.
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("returns null cleanly when neither cache nor DB has the row", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await findByVideoId(env, "missing")

		expect(result).toBeNull()
		expect(db.calls).toHaveLength(1)
		expect(cache.putCalls).toHaveLength(0)
	})

	it("issues a JOIN against users so submitter info is available", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findByVideoId(env, "x")

		const sql = db.calls[0].sql
		expect(sql).toMatch(/FROM\s+lyrics\s+l/i)
		expect(sql).toMatch(/LEFT\s+JOIN\s+users\s+u\s+ON\s+l\.submitter_id\s*=\s*u\.id/i)
		expect(sql).toMatch(/u\.key_id\s+AS\s+submitter_key_id/i)
		expect(sql).toMatch(/u\.reputation\s+AS\s+submitter_reputation/i)
	})

	it("disambiguates ranking columns with `l.` prefix to avoid users.created_at collision", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findByVideoId(env, "x")

		const sql = db.calls[0].sql
		expect(sql).toContain("l.effective_score")
		expect(sql).toContain("l.vote_count")
		expect(sql).toContain("l.created_at")
		// the WHERE clause must reference the lyrics column, not users
		expect(sql).toMatch(/WHERE\s+l\.video_id/i)
	})

	it("returns submitter fields from the joined row", async () => {
		const joinedRow = {
			...baseRow,
			submitter_id: 42,
			submitter_key_id: "abc123",
			submitter_reputation: 1.25,
		}
		const db = createMockDB([joinedRow])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await findByVideoId(env, "vid123")

		expect(result).not.toBeNull()
		expect(result?.submitter_key_id).toBe("abc123")
		expect(result?.submitter_reputation).toBe(1.25)
	})

	it("short-circuits to cache without hitting DB on hit", async () => {
		const cached = {
			...baseRow,
			submitter_id: 7,
			submitter_key_id: "cached-key",
			submitter_reputation: 1.5,
		}
		const cache = createMockCache({ "v:vid123": JSON.stringify(cached) })
		const db = createMockDB([])
		const env = createEnv(db, cache)

		const result = await findByVideoId(env, "vid123")

		expect(db.calls).toHaveLength(0)
		expect(result?.submitter_key_id).toBe("cached-key")
		expect(result?.submitter_reputation).toBe(1.5)
	})

	it("evicts and falls back to DB when cache entry is corrupt", async () => {
		const cache = createMockCache({ "v:vid123": "{not-json" })
		const db = createMockDB([{ ...baseRow }])
		const env = createEnv(db, cache)

		const result = await findByVideoId(env, "vid123")

		expect(cache.deleteCalls).toContain("v:vid123")
		expect(db.calls).toHaveLength(1)
		expect(result).not.toBeNull()
	})

	it("caches the joined row on miss so subsequent calls have submitter info", async () => {
		const joinedRow = {
			...baseRow,
			submitter_id: 9,
			submitter_key_id: "joined",
			submitter_reputation: 0.7,
		}
		const cache = createMockCache()
		const db = createMockDB([joinedRow])
		const env = createEnv(db, cache)

		await findByVideoId(env, "vid123")

		expect(cache.putCalls).toHaveLength(1)
		expect(cache.putCalls[0].key).toBe("v:vid123")
		const cached = JSON.parse(cache.putCalls[0].value)
		expect(cached.submitter_key_id).toBe("joined")
		expect(cached.submitter_reputation).toBe(0.7)
	})

	it("preserves null submitter when row has no submitter_id (anonymous lyrics)", async () => {
		const orphanRow = {
			...baseRow,
			submitter_id: null,
			submitter_key_id: null,
			submitter_reputation: null,
		}
		const db = createMockDB([orphanRow])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await findByVideoId(env, "vid123")

		expect(result?.submitter_id).toBeNull()
		expect(result?.submitter_key_id).toBeNull()
		expect(result?.submitter_reputation).toBeNull()
	})

	it("orders proven rows above unproven rows for same videoId", async () => {
		const provenRow = {
			...baseRow,
			submitter_reputation: 1.5,
			vote_count: 5,
			effective_score: 0.6,
		}
		const db = createMockDB([provenRow])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findByVideoId(env, "v1")

		const lookupCall = db.calls.find((c) => c.sql.includes("FROM lyrics"))
		expect(lookupCall).toBeDefined()
		expect(lookupCall?.sql).toContain("CASE WHEN")
		expect(lookupCall?.sql).toMatch(/COALESCE\(u\.reputation, 0\) > 1/)
		expect(lookupCall?.sql).toMatch(/vote_count >= 3/)
		expect(lookupCall!.sql).toMatch(/ORDER BY \(CASE WHEN[\s\S]+?\) DESC,/)
		const caseIdx = lookupCall!.sql.indexOf("CASE WHEN")
		const rankingIdx = lookupCall!.sql.indexOf(RANKING_EXPR_JOINED)
		expect(caseIdx).toBeGreaterThan(-1)
		expect(rankingIdx).toBeGreaterThan(caseIdx)
	})
})

describe("findBySongArtist", () => {
	it("includes the JOIN", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "song", "artist")

		expect(db.calls[0].sql).toMatch(/LEFT\s+JOIN\s+users\s+u/i)
	})

	it("table-qualifies all WHERE conditions to avoid ambiguity", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "song", "artist", 200, "Album")

		const sql = db.calls[0].sql
		expect(sql).toContain("l.song_norm")
		expect(sql).toContain("l.artist_norm")
		expect(sql).toContain("l.duration")
		expect(sql).toContain("l.album")
	})

	it("normalizes song and artist before binding", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "  Hello WORLD  ", "Test Artist")

		// First two bound params are the normalized song and artist.
		// (Exact normalization rules are tested elsewhere; we just verify
		// they were normalized, i.e., not the raw input.)
		const params = db.calls[0].params
		expect(params[0]).not.toBe("  Hello WORLD  ")
		expect(params[0]).toBe(String(params[0]).toLowerCase().trim())
	})

	it("omits duration filter when not provided", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "song", "artist")

		expect(db.calls[0].sql).not.toContain("ABS")
	})

	it("includes duration tolerance filter when provided", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "song", "artist", 200)

		expect(db.calls[0].sql).toMatch(/ABS\(l\.duration - \?\)\s*<=\s*\?/)
	})

	it("returns submitter fields from joined row", async () => {
		const db = createMockDB([
			{
				...baseRow,
				submitter_key_id: "alice",
				submitter_reputation: 2.0,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await findBySongArtist(env, "song", "artist")

		expect(result?.submitter_key_id).toBe("alice")
		expect(result?.submitter_reputation).toBe(2.0)
	})

	it("orders proven rows above unproven rows for same song+artist", async () => {
		const row = {
			...baseRow,
			submitter_reputation: 1.5,
			vote_count: 5,
			effective_score: 0.6,
		}
		const db = createMockDB([row])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findBySongArtist(env, "Song", "Artist")

		const lookupCall = db.calls.find((c) => c.sql.includes("FROM lyrics"))
		expect(lookupCall).toBeDefined()
		expect(lookupCall?.sql).toContain("CASE WHEN")
		expect(lookupCall?.sql).toMatch(/COALESCE\(u\.reputation, 0\) > 1/)
		const caseIdx = lookupCall!.sql.indexOf("CASE WHEN")
		const rankingIdx = lookupCall!.sql.indexOf(RANKING_EXPR_JOINED)
		expect(caseIdx).toBeGreaterThan(-1)
		expect(rankingIdx).toBeGreaterThan(caseIdx)
	})
})

describe("findVariantsByVideoId", () => {
	it("includes the JOIN and uses prefixed ranking expression", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findVariantsByVideoId(env, "vid", 5)

		const sql = db.calls[0].sql
		expect(sql).toMatch(/LEFT\s+JOIN\s+users\s+u/i)
		expect(sql).toContain("l.effective_score")
	})

	it("returns submitter info on each variant", async () => {
		const variants = [
			{ ...baseRow, id: 1, submitter_key_id: "a", submitter_reputation: 1.0 },
			{ ...baseRow, id: 2, submitter_key_id: "b", submitter_reputation: 1.5 },
		]
		const db = createMockDB([variants])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const results = await findVariantsByVideoId(env, "vid", 10)

		expect(results).toHaveLength(2)
		expect(results[0].submitter_key_id).toBe("a")
		expect(results[1].submitter_key_id).toBe("b")
	})

	it("binds videoId and limit in order", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await findVariantsByVideoId(env, "vid", 7)

		expect(db.calls[0].params).toEqual(["vid", 7])
	})
})

describe("getLyricsById", () => {
	it("issues a JOIN keyed on l.id", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await getLyricsById(env, 42)

		const sql = db.calls[0].sql
		expect(sql).toMatch(/LEFT\s+JOIN\s+users\s+u/i)
		expect(sql).toMatch(/WHERE\s+l\.id\s*=/i)
		expect(db.calls[0].params).toEqual([42])
	})

	it("returns submitter info for the resolved row", async () => {
		const db = createMockDB([
			{
				...baseRow,
				submitter_key_id: "x",
				submitter_reputation: 0.9,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await getLyricsById(env, 1)

		expect(result?.submitter_key_id).toBe("x")
		expect(result?.submitter_reputation).toBe(0.9)
	})
})

describe("searchByQuery", () => {
	it("does not table-prefix columns (no JOIN, so unqualified ranking expression must work)", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await searchByQuery(env, "hello world", 10)

		// searchByQuery composes its own subquery; it must not pull in `l.` prefixes
		// from the JOINed ranking variant or the outer ORDER BY would reference
		// undefined aliases.
		expect(db.calls[0].sql).not.toContain("l.effective_score")
		expect(db.calls[0].sql).not.toContain("l.sync_type")
	})

	it("returns empty array for queries below minQueryLength without hitting DB", async () => {
		const db = createMockDB([])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await searchByQuery(env, "a", 10)

		expect(result).toEqual([])
		expect(db.calls).toHaveLength(0)
	})

	it("returns rows untouched from the DB", async () => {
		const searchHit: LyricsSearchResult = {
			id: 1,
			video_id: "v",
			song: "S",
			artist: "A",
			album: null,
			isrc: null,
			duration: 100,
			format: "lrc",
			language: null,
			sync_type: "linesync",
			score: 0,
			effective_score: 0,
			vote_count: 0,
			confidence: "low",
			created_at: 1700000000,
			match_score: 0.9,
			tier: 1,
		}
		const db = createMockDB([[searchHit]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const results = await searchByQuery(env, "longer query", 10)

		expect(results).toEqual([searchHit])
	})
})

describe("RANKING_EXPR", () => {
	it("references the unprefixed lyrics columns (used by search subquery)", () => {
		expect(RANKING_EXPR).toContain("effective_score")
		expect(RANKING_EXPR).toContain("vote_count")
		expect(RANKING_EXPR).toContain("created_at")
		expect(RANKING_EXPR).not.toMatch(/\bl\.effective_score\b/)
	})

	it("contains all three sync_type weights", () => {
		expect(RANKING_EXPR).toContain("'richsync'")
		expect(RANKING_EXPR).toContain("'linesync'")
	})
})

describe("invalidateCacheAfterDelete", () => {
	it("deletes per-video key and all feed:global:* keys, leaves others", async () => {
		const db = createMockDB()
		const cache = createMockCache({
			"v:abc123": "row",
			"feed:global:20": "feed",
			"feed:global:50": "feed",
			"unrelated:key": "stay",
		})
		const env = createEnv(db, cache)

		await invalidateCacheAfterDelete(env, "abc123")

		expect(cache.deleteCalls).toContain("v:abc123")
		expect(cache.deleteCalls).toContain("feed:global:20")
		expect(cache.deleteCalls).toContain("feed:global:50")
		expect(cache.deleteCalls).not.toContain("unrelated:key")
	})
})

describe("invalidateCacheForSubmitter", () => {
	it("deletes v:<videoId> for every row returned by the join", async () => {
		const db = createMockDB([[{ video_id: "vA" }, { video_id: "vB" }, { video_id: "vC" }]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(cache.deleteCalls).toEqual(["v:vA", "v:vB", "v:vC"])
	})

	it("issues a JOIN on users.key_id and filters deleted rows", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(db.calls).toHaveLength(1)
		const sql = db.calls[0].sql
		expect(sql).toMatch(/JOIN\s+users\s+u\s+ON\s+l\.submitter_id\s*=\s*u\.id/i)
		expect(sql).toMatch(/WHERE\s+u\.key_id\s*=\s*\?/i)
		expect(sql).toMatch(/AND\s+l\.deleted_at\s+IS\s+NULL/i)
		expect(db.calls[0].params).toEqual(["k1"])
	})

	it("uses SELECT DISTINCT so a user's multiple variants per video collapse to one delete", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(db.calls[0].sql).toMatch(/SELECT\s+DISTINCT\s+l\.video_id/i)
	})

	it("is a noop when the user has no submissions", async () => {
		const db = createMockDB([[]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(cache.deleteCalls).toEqual([])
		expect(db.calls).toHaveLength(1)
	})

	it("does not touch unrelated cache keys", async () => {
		const db = createMockDB([[{ video_id: "vA" }]])
		const cache = createMockCache({
			"v:vA": "row",
			"v:other": "stay",
			"feed:global:home": "stay",
		})
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(cache.deleteCalls).toEqual(["v:vA"])
		expect(cache.store.has("v:other")).toBe(true)
		expect(cache.store.has("feed:global:home")).toBe(true)
	})

	it("invariant: cache.put is never called", async () => {
		const db = createMockDB([[{ video_id: "vA" }, { video_id: "vB" }]])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await invalidateCacheForSubmitter(env, "k1")

		expect(cache.putCalls).toEqual([])
	})
})

describe("softDeleteLyrics", () => {
	it("returns not_found when the row does not exist", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 999, 1, "submitter")

		expect(result).toEqual({ deleted: false, reason: "not_found" })
	})

	it("returns already_deleted when the row is already deleted", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 1,
				deleted_at: 1234567890,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 1, "submitter")

		expect(result).toEqual({ deleted: false, reason: "already_deleted" })
	})

	it("returns forbidden when submitter does not own the row", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 99,
				deleted_at: null,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 1, "submitter")

		expect(result).toEqual({ deleted: false, reason: "forbidden" })
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeUndefined()
	})

	it("performs UPDATE with the four audit fields and invalidates cache", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 1,
				deleted_at: null,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
			null,
		])
		const cache = createMockCache({ "v:v1": "row", "feed:global:20": "feed" })
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 1, "submitter", "typo")

		expect(result.deleted).toBe(true)
		const update = db.calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("deleted_at =")
		)
		expect(update).toBeDefined()
		expect(update?.sql).toMatch(/deleted_at\s*=/)
		expect(update?.sql).toMatch(/deleted_by_user_id\s*=/)
		expect(update?.sql).toMatch(/deleted_by_role\s*=/)
		expect(update?.sql).toMatch(/deletion_reason\s*=/)
		expect(update?.sql).toMatch(/WHERE\s+id\s*=\s*\?\s+AND\s+deleted_at\s+IS\s+NULL/i)
		expect(update?.params).toEqual([1, "submitter", "typo", 1])
		expect(cache.deleteCalls).toContain("v:v1")
		expect(cache.deleteCalls).toContain("feed:global:20")
	})

	it("admin role bypasses ownership check", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 99,
				deleted_at: null,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: true,
			},
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 1, "admin", "DMCA")

		expect(result.deleted).toBe(true)
		const update = db.calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("deleted_at =")
		)
		expect(update?.params).toEqual([1, "admin", "DMCA", 1])
	})

	it("applies the reputation penalty when a net-negative row is self-deleted", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 3,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			{ id: 1 },
			null,
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 42, "submitter", "regret")

		expect(result.deleted).toBe(true)

		const markUpdate = db.calls.find(
			(c) =>
				c.sql.includes("UPDATE lyrics") &&
				c.sql.includes("reputation_penalized = TRUE") &&
				!c.sql.includes("deleted_at")
		)
		expect(markUpdate).toBeDefined()
		expect(markUpdate?.sql).toMatch(/AND\s+reputation_penalized\s*=\s*FALSE/i)
		expect(markUpdate?.sql).toMatch(/RETURNING\s+id/i)
		expect(markUpdate?.params).toEqual([1])

		const penaltyUpdate = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penaltyUpdate).toBeDefined()
		expect(penaltyUpdate?.params).toEqual([
			config.reputation.min,
			config.moderation.autoHide.reputationPenalty,
			42,
		])

		const softDelete = db.calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("deleted_at =")
		)
		expect(softDelete?.params).toEqual([42, "submitter", "regret", 1])
	})

	it("skips user decrement when a concurrent caller flipped the flag first", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 3,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			null,
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 42, "submitter", "regret")

		expect(result.deleted).toBe(true)

		const penaltyUpdate = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penaltyUpdate).toBeUndefined()

		const softDelete = db.calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("deleted_at =")
		)
		expect(softDelete).toBeDefined()
	})

	it("does NOT penalise a clean self-delete with vote_count < 2", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 1,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 42, "submitter", null)

		expect(result.deleted).toBe(true)
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeUndefined()
	})

	it("does NOT penalise a clean self-delete with non-negative effective_score", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 5,
				effective_score: 0.1,
				reputation_penalized: false,
			},
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 42, "submitter", null)

		expect(result.deleted).toBe(true)
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeUndefined()
	})

	it("always penalises an admin delete regardless of score", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
			{ id: 1 },
			null,
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 1, "admin", "DMCA")

		expect(result.deleted).toBe(true)
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeDefined()
		expect(penalty?.params).toEqual([
			config.reputation.min,
			config.moderation.autoHide.reputationPenalty,
			42,
		])

		const markUpdate = db.calls.find(
			(c) =>
				c.sql.includes("UPDATE lyrics") &&
				c.sql.includes("reputation_penalized = TRUE") &&
				!c.sql.includes("deleted_at")
		)
		expect(markUpdate?.params).toEqual([1])
	})

	it("does NOT double-penalise when reputation_penalized is already TRUE", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 3,
				effective_score: -0.6,
				reputation_penalized: true,
			},
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await softDeleteLyrics(env, 1, 42, "submitter", null)

		expect(result.deleted).toBe(true)
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeUndefined()
		const mark = db.calls.find(
			(c) =>
				c.sql.includes("UPDATE lyrics") &&
				c.sql.includes("reputation_penalized = TRUE") &&
				!c.sql.includes("deleted_at")
		)
		expect(mark).toBeUndefined()
	})

	it("wraps penalty, mark, and soft-delete in a single transaction (penalty branch)", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 3,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			{ id: 1 },
			null,
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await softDeleteLyrics(env, 1, 42, "submitter", "regret")

		expect(db.transactionCount).toBe(1)
	})

	it("wraps the soft-delete in a transaction even when the penalty branch is skipped", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 1,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await softDeleteLyrics(env, 1, 42, "submitter", null)

		expect(db.transactionCount).toBe(1)
		const penalty = db.calls.find(
			(c) => c.sql.includes("UPDATE users") && c.sql.includes("reputation - ?")
		)
		expect(penalty).toBeUndefined()
	})

	it("does not open a transaction when the row is not found", async () => {
		const db = createMockDB([null])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await softDeleteLyrics(env, 999, 1, "submitter")

		expect(db.transactionCount).toBe(0)
	})

	it("does not open a transaction when the row is already deleted", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 1,
				deleted_at: 1234567890,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await softDeleteLyrics(env, 1, 1, "submitter")

		expect(db.transactionCount).toBe(0)
	})

	it("does not open a transaction when the caller is forbidden", async () => {
		const db = createMockDB([
			{
				id: 1,
				video_id: "v1",
				submitter_id: 99,
				deleted_at: null,
				vote_count: 0,
				effective_score: 0,
				reputation_penalized: false,
			},
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await softDeleteLyrics(env, 1, 1, "submitter")

		expect(db.transactionCount).toBe(0)
	})

	it("rolls back the soft-delete when the penalty update throws", async () => {
		const calls: Recorded[] = []
		const state = { transactionCount: 0, committed: true }
		const queue: unknown[] = [
			{
				id: 1,
				video_id: "v1",
				submitter_id: 42,
				deleted_at: null,
				vote_count: 3,
				effective_score: -0.6,
				reputation_penalized: false,
			},
			{ id: 1 },
		]
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
								if (sql.includes("UPDATE users") && sql.includes("reputation - ?")) {
									throw new Error("simulated failure")
								}
							},
						}
					},
				}
			},
			async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
				state.transactionCount++
				try {
					return await fn(db)
				} catch (err) {
					state.committed = false
					throw err
				}
			},
		}
		const cache = createMockCache()
		const env = {
			DB: db as unknown as Env["DB"],
			CACHE: cache as unknown as Env["CACHE"],
			RATE_LIMITER: {} as Env["RATE_LIMITER"],
			READ_RATE_LIMITER: {} as Env["READ_RATE_LIMITER"],
			CACHE_TTL_SECONDS: "300",
			DUMPS_ENABLED: false,
			DUMP_PUBLIC_BASE_URL: "",
			DUMP_DATABASE_URL: null,
			B2: null,
		} as Env

		await expect(softDeleteLyrics(env, 1, 42, "submitter", "regret")).rejects.toThrow(
			"simulated failure"
		)
		expect(state.transactionCount).toBe(1)
		expect(state.committed).toBe(false)
		const softDelete = calls.find(
			(c) => c.sql.includes("UPDATE lyrics") && c.sql.includes("deleted_at =")
		)
		expect(softDelete).toBeUndefined()
		expect(cache.deleteCalls).toHaveLength(0)
	})
})

describe("read paths filter deleted rows", () => {
	const cases: Array<{ name: string; run: (env: Env) => Promise<unknown> }> = [
		{ name: "findByVideoId", run: (env) => findByVideoId(env, "v1") },
		{ name: "findVariantsByVideoId", run: (env) => findVariantsByVideoId(env, "v1", 5) },
		{ name: "findBySongArtist", run: (env) => findBySongArtist(env, "s", "a") },
		{ name: "getLyricsById", run: (env) => getLyricsById(env, 1) },
		{ name: "searchByQuery", run: (env) => searchByQuery(env, "hello world", 10) },
	]

	for (const c of cases) {
		it(`${c.name} adds deleted_at IS NULL to its WHERE`, async () => {
			const db = createMockDB([null])
			const cache = createMockCache()
			const env = createEnv(db, cache)
			await c.run(env)
			const sql = db.calls.map((x) => x.sql).join("\n")
			expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
		})
	}
})

describe("AUTO_HIDE_PREDICATE", () => {
	it("encodes the standard path: 5 votes, 80% downvotes, effective_score < -0.5", () => {
		expect(AUTO_HIDE_PREDICATE).toContain("vote_count >= 5")
		expect(AUTO_HIDE_PREDICATE).toContain("downvotes >= 0.8 * vote_count")
		expect(AUTO_HIDE_PREDICATE).toContain("effective_score < -0.5")
	})

	it("encodes the decisive path: 3 unanimous downvotes aged 3 days", () => {
		expect(AUTO_HIDE_PREDICATE).toContain("vote_count >= 3")
		expect(AUTO_HIDE_PREDICATE).toContain("downvotes = vote_count")
		expect(AUTO_HIDE_PREDICATE).toContain("- created_at >= 259200")
	})

	it("combines the two paths with OR", () => {
		expect(AUTO_HIDE_PREDICATE).toMatch(/\)\s*OR\s*\(/)
	})

	it("uses unprefixed columns so it is safe inside the search subqueries", () => {
		expect(AUTO_HIDE_PREDICATE).not.toMatch(/\bl\./)
	})
})

describe("auto-hide filter on lookups and search", () => {
	const hideCases: Array<{ name: string; run: (env: Env) => Promise<unknown> }> = [
		{ name: "findByVideoId", run: (env) => findByVideoId(env, "v1") },
		{ name: "findBySongArtist", run: (env) => findBySongArtist(env, "s", "a") },
		{ name: "searchBySongArtist", run: (env) => searchBySongArtist(env, "s", "a") },
		{ name: "searchByQuery", run: (env) => searchByQuery(env, "hello world", 10) },
	]

	for (const c of hideCases) {
		it(`${c.name} excludes auto-hidden variants`, async () => {
			const db = createMockDB([null])
			const env = createEnv(db, createMockCache())
			await c.run(env)
			const sql = db.calls.map((x) => x.sql).join("\n")
			expect(sql).toContain("NOT (")
			expect(sql).toMatch(/downvotes >= 0\.8 \* (?:l\.)?vote_count/)
		})
	}
})

describe("hidden flag on browse surfaces", () => {
	const flagCases: Array<{ name: string; run: (env: Env) => Promise<unknown> }> = [
		{ name: "findVariantsByVideoId", run: (env) => findVariantsByVideoId(env, "v1", 5) },
		{ name: "getLyricsById", run: (env) => getLyricsById(env, 1) },
	]

	for (const c of flagCases) {
		it(`${c.name} selects the predicate as a hidden column`, async () => {
			const db = createMockDB([null])
			const env = createEnv(db, createMockCache())
			await c.run(env)
			expect(db.calls[0].sql).toMatch(/AS\s+hidden/i)
		})
	}

	it("findVariantsByVideoId does NOT filter hidden variants out", async () => {
		const db = createMockDB([[]])
		const env = createEnv(db, createMockCache())
		await findVariantsByVideoId(env, "v1", 5)
		expect(db.calls[0].sql).not.toContain("AND NOT")
	})
})

function buildSubmission(over: Partial<LyricsSubmission> = {}): LyricsSubmission {
	return {
		videoId: "vid-sub",
		song: "Song",
		artist: "Artist",
		duration: 200,
		lyrics: SAMPLE_LYRICS,
		format: "lrc",
		syncType: "linesync",
		...over,
	}
}

describe("submitLyrics fulfillment integration", () => {
	it("records a fulfillment for synced submissions with live demand", async () => {
		const db = createMockDB([
			{ count: 0 },
			{ id: 555 },
			{ key_id: "k1" },
			null,
			null,
			{ demand: 4, request_count: 2 },
			{ id: 1 },
			null,
		])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await submitLyrics(env, buildSubmission({ syncType: "linesync" }), 7)

		expect(result.created).toBe(true)
		const sqls = db.calls.map((c) => c.sql).join("\n")
		expect(sqls).toMatch(/INSERT INTO request_fulfillments/i)
		expect(sqls).toMatch(/DELETE FROM lyrics_requests/i)
	})

	it("skips fulfillment for plain submissions", async () => {
		const db = createMockDB([{ count: 0 }, { id: 556 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await submitLyrics(env, buildSubmission({ syncType: "plain" }), 7)

		const sqls = db.calls.map((c) => c.sql).join("\n")
		expect(sqls).not.toMatch(/INSERT INTO request_fulfillments/i)
	})

	it("skips fulfillment when a prior synced variant exists", async () => {
		const db = createMockDB([{ count: 0 }, { id: 557 }, { key_id: "k1" }, null, { "1": 1 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		await submitLyrics(env, buildSubmission({ syncType: "richsync" }), 7)

		const sqls = db.calls.map((c) => c.sql).join("\n")
		expect(sqls).not.toMatch(/INSERT INTO request_fulfillments/i)
	})
})

describe("submitLyrics variant cap", () => {
	it("counts penalized-and-deleted rows against the variant cap", async () => {
		const db = createMockDB([{ count: 3 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const result = await submitLyrics(env, buildSubmission(), 42)

		expect(result.created).toBe(false)

		const countCall = db.calls.find(
			(c) => c.sql.includes("SELECT COUNT(*)") && c.sql.includes("lyrics")
		)
		expect(countCall).toBeDefined()
		expect(countCall!.sql).toMatch(/reputation_penalized\s*=\s*TRUE/i)
		expect(countCall!.sql).toMatch(/deleted_at\s+IS\s+NULL/i)
	})
})

describe("submitLyrics language detection", () => {
	const ENGLISH_LYRICS_SAMPLE = [
		"In your arms I find the answer to every question",
		"You whisper softly and the world begins to spin",
		"Holding on tight to the moments we have together",
		"Every heartbeat is a song that only we can hear",
	].join("\n")

	it("auto-detects language when submitter omits it", async () => {
		const db = createMockDB([{ count: 0 }, { id: 42 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const submission: LyricsSubmission = {
			videoId: "vid42",
			song: "Test",
			artist: "Tester",
			duration: 200,
			lyrics: ENGLISH_LYRICS_SAMPLE,
			format: "plain",
			syncType: "plain",
		}

		await submitLyrics(env, submission, 1)

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO lyrics"))
		expect(insertCall).toBeDefined()
		expect(insertCall!.sql).toContain("language")
		expect(insertCall!.sql).toContain("language_detection_attempted_at")
		expect(insertCall!.params).toContain("en")
		expect(insertCall!.sql).toContain("language_detector_version")
		expect(insertCall!.sql).toContain("language_source")
		expect(insertCall!.params).toContain("detector")
		expect(insertCall!.params).toHaveLength(17)
	})

	it("stamps null detector version when eld is not loaded yet (cold-start window)", async () => {
		const db = createMockDB([{ count: 0 }, { id: 45 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const submission: LyricsSubmission = {
			videoId: "vid45",
			song: "Test",
			artist: "Tester",
			duration: 200,
			lyrics: ENGLISH_LYRICS_SAMPLE,
			format: "plain",
			syncType: "plain",
		}

		await submitLyrics(env, submission, 1)

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO lyrics"))
		const versionIdx = insertCall!.params.length - 2
		expect(insertCall!.params[versionIdx]).toBeNull()
	})

	it("preserves submitter language even when detection disagrees", async () => {
		const warnSpy = vi.spyOn(Logger.prototype, "warn")
		const db = createMockDB([{ count: 0 }, { id: 43 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const submission: LyricsSubmission = {
			videoId: "vid43",
			song: "Test",
			artist: "Tester",
			duration: 200,
			lyrics: ENGLISH_LYRICS_SAMPLE,
			format: "plain",
			syncType: "plain",
			language: "es",
		}

		await submitLyrics(env, submission, 1)

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO lyrics"))
		expect(insertCall!.params).toContain("es")
		expect(insertCall!.params).not.toContain("en")
		expect(insertCall!.params).toContain("submitter")
		expect(warnSpy).toHaveBeenCalledWith(
			"language mismatch",
			expect.objectContaining({ submitted: "es", detected: "en" })
		)
		warnSpy.mockRestore()
	})

	it("stores null language when detection cannot confidently identify a language", async () => {
		const db = createMockDB([{ count: 0 }, { id: 44 }])
		const cache = createMockCache()
		const env = createEnv(db, cache)

		const submission: LyricsSubmission = {
			videoId: "vid44",
			song: "Instrumental",
			artist: "Tester",
			duration: 200,
			lyrics: "oh oh oh",
			format: "plain",
			syncType: "plain",
		}

		await submitLyrics(env, submission, 1)

		const insertCall = db.calls.find((c) => c.sql.includes("INSERT INTO lyrics"))
		expect(insertCall!.sql).toContain("language_detection_attempted_at")
		expect(insertCall!.params).toContain(null)
	})
})
