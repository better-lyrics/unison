import type { Env } from "@/types"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"
import { describe, expect, it } from "vitest"
import { backfillNorms } from "./backfill-norms"

interface StoreRow {
	id: number
	song: string
	artist: string
	album: string | null
	song_norm: string
	artist_norm: string
	album_norm: string | null
	deleted_at: number | null
}

function createStore(initial: Array<Partial<StoreRow> & { id: number }>) {
	const rows: StoreRow[] = initial.map((r) => ({
		song: "",
		artist: "",
		album: null,
		song_norm: "",
		artist_norm: "",
		album_norm: null,
		deleted_at: null,
		...r,
	}))
	const updates: Array<{ id: number; params: unknown[] }> = []

	const db = {
		prepare(sql: string) {
			return {
				bind(...params: unknown[]) {
					return {
						async first<T>(): Promise<T | null> {
							return null
						},
						async all<T>(): Promise<{ results: T[] }> {
							const afterId = Number(params[0])
							const limit = Number(params[1])
							const page = rows
								.filter((r) => r.id > afterId && r.deleted_at === null)
								.sort((a, b) => a.id - b.id)
								.slice(0, limit)
							return { results: page.map((r) => ({ ...r })) as unknown as T[] }
						},
						async run(): Promise<void> {
							if (!/UPDATE/i.test(sql)) return
							const [songNorm, artistNorm, albumNorm, id] = params
							const row = rows.find((r) => r.id === id)
							if (row) {
								row.song_norm = songNorm as string
								row.artist_norm = artistNorm as string
								row.album_norm = albumNorm as string | null
							}
							updates.push({ id: id as number, params })
						},
					}
				},
			}
		},
	}

	return { rows, updates, db }
}

function buildEnv(db: ReturnType<typeof createStore>["db"]): Env {
	return {
		DB: db,
		CACHE: {
			get: async () => null,
			put: async () => undefined,
			delete: async () => undefined,
			keys: async () => [],
		},
		CACHE_TTL_SECONDS: "0",
		RATE_LIMITER: { check: async () => ({ ok: true, remaining: 0 }) },
	} as unknown as Env
}

describe("backfillNorms", () => {
	describe("happy paths", () => {
		it("recomputes empty norms for a Japanese row (regression: issue #54)", async () => {
			const store = createStore([
				{ id: 1, song: "いますぐ輪廻", artist: "なきそ", song_norm: "", artist_norm: "" },
			])

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 1, updated: 1 })
			expect(store.rows[0].song_norm).toBe(normalizeSong("いますぐ輪廻"))
			expect(store.rows[0].artist_norm).toBe(normalizeArtist("なきそ"))
			expect(store.rows[0].song_norm).toBe("いますぐ輪廻")
			expect(store.rows[0].artist_norm).toBe("なきそ")
		})

		it("recomputes a stale album_norm", async () => {
			const store = createStore([
				{
					id: 1,
					song: "Song",
					artist: "Artist",
					album: "Café",
					song_norm: "song",
					artist_norm: "artist",
					album_norm: "café",
				},
			])

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 1, updated: 1 })
			expect(store.rows[0].album_norm).toBe(normalize("Café"))
			expect(store.rows[0].album_norm).toBe("cafe")
		})
	})

	describe("idempotence", () => {
		it("leaves an already-correct Latin row untouched", async () => {
			const store = createStore([
				{
					id: 1,
					song: "Bohemian Rhapsody",
					artist: "Queen",
					song_norm: normalizeSong("Bohemian Rhapsody"),
					artist_norm: normalizeArtist("Queen"),
				},
			])

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 1, updated: 0 })
			expect(store.updates).toHaveLength(0)
		})

		it("advances the cursor and terminates when every row is already correct", async () => {
			const store = createStore(
				Array.from({ length: 5 }, (_, i) => ({
					id: i + 1,
					song: `Song ${i + 1}`,
					artist: "Artist",
					song_norm: normalizeSong(`Song ${i + 1}`),
					artist_norm: normalizeArtist("Artist"),
				}))
			)

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 5, updated: 0 })
			expect(store.updates).toHaveLength(0)
		})
	})

	describe("edge cases", () => {
		it("skips soft-deleted rows", async () => {
			const store = createStore([
				{ id: 1, song: "今すぐ輪廻", artist: "なきそ", song_norm: "", deleted_at: 1700000000 },
			])

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 0, updated: 0 })
			expect(store.rows[0].song_norm).toBe("")
		})

		it("only updates the rows that actually changed", async () => {
			const store = createStore([
				{
					id: 1,
					song: "방탄소년단",
					artist: "Artist",
					song_norm: "",
					artist_norm: normalizeArtist("Artist"),
				},
				{
					id: 2,
					song: "Correct",
					artist: "Artist",
					song_norm: normalizeSong("Correct"),
					artist_norm: normalizeArtist("Artist"),
				},
			])

			const result = await backfillNorms(buildEnv(store.db))

			expect(result).toEqual({ scanned: 2, updated: 1 })
			expect(store.updates.map((u) => u.id)).toEqual([1])
			expect(store.rows[0].song_norm).toBe("방탄소년단")
		})
	})
})
