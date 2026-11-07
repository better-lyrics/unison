import { readFileSync } from "node:fs"
import { config } from "@/config"
import { getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import type { Storage } from "@/infra/storage"
import {
	type ArtworkHit,
	type ArtworkSource,
	artworkCacheKey,
	resolveArtwork,
} from "@/services/artwork"
import type { Env } from "@/types"
import pg from "pg"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const NEVER = () => 1
const ALWAYS = () => 0
const ATV = "fHI8X4OXluQ"
const OMV = "4NRXx6U8ABQ"
const ALBUM_ART = "https://lh3.googleusercontent.com/after=w544-h544-l90-rj"

function source(find: ArtworkSource["find"], over: Partial<ArtworkSource> = {}): ArtworkSource {
	return { name: "test", onRefresh: true, find: vi.fn(find), ...over }
}

const finds = (url: string | null) => source(async () => (url ? { url } : null))

function makeMapCache() {
	const store = new Map<string, string>()
	const ttls = new Map<string, number>()
	return {
		store,
		ttls,
		async get(k: string): Promise<string | null> {
			return store.has(k) ? (store.get(k) as string) : null
		},
		async put(k: string, v: string, opts?: { expirationTtl?: number }): Promise<void> {
			store.set(k, v)
			if (opts?.expirationTtl) ttls.set(k, opts.expirationTtl)
		},
		async delete(k: string): Promise<void> {
			store.delete(k)
		},
	}
}

function makeCdn() {
	const puts: { key: string; cacheControl?: string }[] = []
	const cdn = {
		async putObject(key: string, _b: Buffer, _t: string, _l?: number, cacheControl?: string) {
			puts.push({ key, cacheControl })
		},
	} as unknown as Storage
	return { cdn, puts }
}

describeIntegration("resolveArtwork (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let cache: ReturnType<typeof makeMapCache>
	let env: Env

	async function seedLyric(videoId: string, isrc: string | null = null): Promise<number> {
		const r = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, isrc)
			 VALUES ($1,'Blinding Lights','The Weeknd',200,'blinding lights','the weeknd','x','plain','plain',$2) RETURNING id`,
			[videoId, isrc]
		)
		return r.rows[0].id
	}

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		for (const table of [
			"song_artwork",
			"lyrics_video_ids",
			"contribution_events",
			"boosts",
			"badge_awards",
			"committee_members",
			"request_fulfillments",
			"lyrics_requests",
			"requested_songs",
			"votes",
			"reports",
			"lyrics",
			"users",
			"public_keys",
		]) {
			await pool.query(`DELETE FROM ${table}`)
		}
		cache = makeMapCache()
		env = { DB: new D1Compat(pool), CACHE: cache, CDN: null } as unknown as Env
	})

	it("resolves through the sources on a cold miss and caches to DB + Redis", async () => {
		await seedLyric(ATV)
		const art = finds(ALBUM_ART)
		expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBe(ALBUM_ART)
		expect(cache.store.get(artworkCacheKey(ATV))).toBe(ALBUM_ART)
		expect((await getVideoArtwork(env, ATV))?.artworkUrl).toBe(ALBUM_ART)

		expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBe(ALBUM_ART)
		expect(art.find).toHaveBeenCalledTimes(1)
	})

	it("serves a DB hit without the sources and warms Redis", async () => {
		await upsertVideoArtwork(env, ATV, ALBUM_ART)
		const art = finds("https://should-not-be-called")
		expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBe(ALBUM_ART)
		expect(art.find).not.toHaveBeenCalled()
		expect(cache.store.get(artworkCacheKey(ATV))).toBe(ALBUM_ART)
	})

	describe("source order", () => {
		it("takes the first source that finds a cover and asks no later one", async () => {
			await seedLyric(ATV)
			const miss = finds(null)
			const first = finds(ALBUM_ART)
			const later = finds("https://later")
			expect(await resolveArtwork(env, ATV, { sources: [miss, first, later], random: NEVER })).toBe(
				ALBUM_ART
			)
			expect(miss.find).toHaveBeenCalledTimes(1)
			expect(later.find).not.toHaveBeenCalled()
		})

		it("hands every source the lyric's song, artist and ISRC", async () => {
			await seedLyric(ATV, "USUG11904206")
			const art = finds(ALBUM_ART)
			await resolveArtwork(env, ATV, { sources: [art], random: NEVER })
			expect(art.find).toHaveBeenCalledWith(expect.anything(), ATV, {
				song: "Blinding Lights",
				artist: "The Weeknd",
				isrc: "USUG11904206",
			})
		})

		it("resolves a linked video through its lyric", async () => {
			const id = await seedLyric(OMV)
			await pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2),($1,$3)",
				[id, OMV, ATV]
			)
			expect(await resolveArtwork(env, ATV, { sources: [finds(ALBUM_ART)], random: NEVER })).toBe(
				ALBUM_ART
			)
		})

		it("resolves a requested song that has no lyric yet", async () => {
			await pool.query(
				"INSERT INTO requested_songs (video_id, song, artist) VALUES ($1,'Blinding Lights','The Weeknd')",
				[ATV]
			)
			expect(await resolveArtwork(env, ATV, { sources: [finds(ALBUM_ART)], random: NEVER })).toBe(
				ALBUM_ART
			)
		})
	})

	describe("mirrored covers", () => {
		async function jpeg(): Promise<Buffer> {
			return sharp({ create: { width: 600, height: 600, channels: 3, background: "#c33" } })
				.jpeg()
				.toBuffer()
		}

		it("uploads a cover that is not YouTube Music art under the artwork folder and serves the CDN url", async () => {
			await seedLyric(ATV)
			const { cdn, puts } = makeCdn()
			env = { ...env, CDN: cdn } as Env
			const bytes = await jpeg()
			const crop = source(async (): Promise<ArtworkHit> => ({ bytes }))
			const url = await resolveArtwork(env, ATV, { sources: [crop], random: NEVER })
			expect(url?.startsWith(`${config.artwork.cdnBase}${ATV}-`)).toBe(true)
			expect(puts).toEqual([
				{
					key: url?.replace(config.artwork.cdnBase, config.artwork.cdnKeyPrefix),
					cacheControl: config.artwork.cdnCacheControl,
				},
			])
		})

		it("falls through to the next source when there is no CDN to mirror into", async () => {
			await seedLyric(ATV)
			const bytes = await jpeg()
			const crop = source(async (): Promise<ArtworkHit> => ({ bytes }))
			expect(await resolveArtwork(env, ATV, { sources: [crop], random: NEVER })).toBeNull()
			expect(await getVideoArtwork(env, ATV)).toBeNull()
		})
	})

	describe("edge cases", () => {
		it("returns null for a video with no known song, without asking any source", async () => {
			const art = finds(ALBUM_ART)
			expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBeNull()
			expect(art.find).not.toHaveBeenCalled()
		})

		it("ignores a deleted lyric", async () => {
			const id = await seedLyric(ATV)
			const user = await pool.query("INSERT INTO users (key_id) VALUES ('k') RETURNING id")
			await pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'admin' WHERE id = $1",
				[id, user.rows[0].id]
			)
			const art = finds(ALBUM_ART)
			expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBeNull()
			expect(art.find).not.toHaveBeenCalled()
		})

		it("negative-caches a null result", async () => {
			await seedLyric(ATV)
			const art = finds(null)
			expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBeNull()
			expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBeNull()
			expect(art.find).toHaveBeenCalledTimes(1)
			expect(cache.store.get(artworkCacheKey(ATV))).toBe("__none__")
		})

		it("regression: re-resolves a stored empty result instead of serving it", async () => {
			await seedLyric(ATV)
			await upsertVideoArtwork(env, ATV, null)
			expect(await resolveArtwork(env, ATV, { sources: [finds(ALBUM_ART)], random: NEVER })).toBe(
				ALBUM_ART
			)
			expect((await getVideoArtwork(env, ATV))?.artworkUrl).toBe(ALBUM_ART)
		})

		it("regression: ignores entries cached under the previous key", async () => {
			await seedLyric(ATV)
			cache.store.set(`artwork:v2:${ATV}`, "__none__")
			expect(await resolveArtwork(env, ATV, { sources: [finds(ALBUM_ART)], random: NEVER })).toBe(
				ALBUM_ART
			)
		})

		it("serves a negative Redis hit as null", async () => {
			cache.store.set(artworkCacheKey(ATV), "__none__")
			const art = finds(ALBUM_ART)
			expect(await resolveArtwork(env, ATV, { sources: [art], random: NEVER })).toBeNull()
			expect(art.find).not.toHaveBeenCalled()
		})

		it("saves a cover found after an earlier source failed, so avatars and banners can read it", async () => {
			await seedLyric(ATV)
			const down = source(async () => {
				throw new Error("rate limited")
			})
			expect(
				await resolveArtwork(env, ATV, { sources: [down, finds(ALBUM_ART)], random: NEVER })
			).toBe(ALBUM_ART)
			expect((await getVideoArtwork(env, ATV))?.artworkUrl).toBe(ALBUM_ART)
			expect(cache.ttls.get(artworkCacheKey(ATV))).toBe(config.artwork.positiveTtlSeconds)
		})

		it("retries soon, without saving, when nothing was found while a source was down", async () => {
			await seedLyric(ATV)
			const down = source(async () => {
				throw new Error("rate limited")
			})
			expect(
				await resolveArtwork(env, ATV, { sources: [down, finds(null)], random: NEVER })
			).toBeNull()
			expect(await getVideoArtwork(env, ATV)).toBeNull()
			expect(cache.ttls.get(artworkCacheKey(ATV))).toBe(config.artwork.incompleteTtlSeconds)
		})
	})

	describe("probabilistic refresh", () => {
		it("re-asks only the refresh sources and updates cache + DB", async () => {
			await seedLyric(ATV)
			await upsertVideoArtwork(env, ATV, "https://old=w544-h544")
			cache.store.set(artworkCacheKey(ATV), "https://old=w544-h544")
			const fresh = finds(ALBUM_ART)
			const costly = source(async () => ({ url: "https://costly" }), { onRefresh: false })

			const served = await resolveArtwork(env, ATV, { sources: [costly, fresh], random: ALWAYS })
			expect(served).toBe("https://old=w544-h544")
			await vi.waitFor(() => expect(cache.store.get(artworkCacheKey(ATV))).toBe(ALBUM_ART))
			expect(costly.find).not.toHaveBeenCalled()
		})

		it("regression: does not clobber existing artwork when the refresh finds nothing", async () => {
			await seedLyric(ATV)
			await upsertVideoArtwork(env, ATV, ALBUM_ART)
			cache.store.set(artworkCacheKey(ATV), ALBUM_ART)
			const nothing = finds(null)

			expect(await resolveArtwork(env, ATV, { sources: [nothing], random: ALWAYS })).toBe(ALBUM_ART)
			await vi.waitFor(() => expect(nothing.find).toHaveBeenCalledTimes(1))
			expect(cache.store.get(artworkCacheKey(ATV))).toBe(ALBUM_ART)
			expect((await getVideoArtwork(env, ATV))?.artworkUrl).toBe(ALBUM_ART)
		})
	})
})
