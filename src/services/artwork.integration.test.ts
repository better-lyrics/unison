import { readFileSync } from "node:fs"
import { getVideoArtwork, upsertVideoArtwork } from "@/db/artwork"
import { D1Compat } from "@/infra/database"
import { resolveArtwork } from "@/services/artwork"
import type { Env } from "@/types"
import type { SongCandidate } from "@/utils/innertube"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const NEVER = () => 1
const ATV = "fHI8X4OXluQ"
const OMV = "4NRXx6U8ABQ"
const ALBUM_ART = "https://lh3.googleusercontent.com/after=w544-h544-l90-rj"

function hit(over: Partial<SongCandidate> & Pick<SongCandidate, "videoId">): SongCandidate {
	return {
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		artistChannelIds: ["UCweeknd"],
		album: "After Hours",
		durationSeconds: 200,
		videoType: "song",
		artworkUrl: ALBUM_ART,
		...over,
	}
}

function makeMapCache() {
	const store = new Map<string, string>()
	return {
		store,
		async get(k: string): Promise<string | null> {
			return store.has(k) ? (store.get(k) as string) : null
		},
		async put(k: string, v: string): Promise<void> {
			store.set(k, v)
		},
		async delete(k: string): Promise<void> {
			store.delete(k)
		},
	}
}

describeIntegration("resolveArtwork (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let cache: ReturnType<typeof makeMapCache>
	let env: Env

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
		env = { DB: new D1Compat(pool), CACHE: cache } as unknown as Env
	})

	it("resolves via the resolver on a cold miss and caches to DB + Redis", async () => {
		const resolver = vi.fn(async () => "https://art/x=w544-h544")
		const url = await resolveArtwork(env, "v1", { resolver, random: NEVER })
		expect(url).toBe("https://art/x=w544-h544")
		expect(resolver).toHaveBeenCalledTimes(1)
		expect(cache.store.get("artwork:v1")).toBe("https://art/x=w544-h544")

		const again = await resolveArtwork(env, "v1", { resolver, random: NEVER })
		expect(again).toBe("https://art/x=w544-h544")
		expect(resolver).toHaveBeenCalledTimes(1)
	})

	it("serves a DB hit without the resolver and warms Redis", async () => {
		await upsertVideoArtwork(env, "v2", "https://art/db=w544-h544")
		const resolver = vi.fn(async () => "https://should-not-be-called")
		expect(await resolveArtwork(env, "v2", { resolver, random: NEVER })).toBe(
			"https://art/db=w544-h544"
		)
		expect(resolver).not.toHaveBeenCalled()
		expect(cache.store.get("artwork:v2")).toBe("https://art/db=w544-h544")
	})

	describe("edge cases", () => {
		it("negative-caches a null result", async () => {
			const resolver = vi.fn(async () => null)
			expect(await resolveArtwork(env, "v3", { resolver, random: NEVER })).toBeNull()
			expect(await resolveArtwork(env, "v3", { resolver, random: NEVER })).toBeNull()
			expect(resolver).toHaveBeenCalledTimes(1)
			expect(cache.store.get("artwork:v3")).toBe("__none__")
		})

		it("serves a negative Redis hit as null", async () => {
			cache.store.set("artwork:v4", "__none__")
			const resolver = vi.fn(async () => "https://should-not-be-called")
			expect(await resolveArtwork(env, "v4", { resolver, random: NEVER })).toBeNull()
			expect(resolver).not.toHaveBeenCalled()
		})
	})

	describe("probabilistic refresh", () => {
		it("re-resolves and updates cache + DB when random triggers", async () => {
			await upsertVideoArtwork(env, "v5", "https://old=w544-h544")
			cache.store.set("artwork:v5", "https://old=w544-h544")
			const resolver = vi.fn(async () => "https://new=w544-h544")
			const ALWAYS = () => 0

			const served = await resolveArtwork(env, "v5", { resolver, random: ALWAYS })
			expect(served).toBe("https://old=w544-h544")
			await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
			await vi.waitFor(() => expect(cache.store.get("artwork:v5")).toBe("https://new=w544-h544"))
		})

		it("regression: does not clobber existing artwork when the refresh resolves null", async () => {
			await upsertVideoArtwork(env, "v6", "https://good=w544-h544")
			cache.store.set("artwork:v6", "https://good=w544-h544")
			const resolver = vi.fn(async () => null)
			const ALWAYS = () => 0

			const served = await resolveArtwork(env, "v6", { resolver, random: ALWAYS })
			expect(served).toBe("https://good=w544-h544")
			await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1))
			expect(cache.store.get("artwork:v6")).toBe("https://good=w544-h544")
			const row = await getVideoArtwork(env, "v6")
			expect(row?.artworkUrl).toBe("https://good=w544-h544")
		})
	})

	describe("search resolver", () => {
		async function seedLyric(videoId: string): Promise<number> {
			const r = await pool.query(
				`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type)
				 VALUES ($1,'Blinding Lights','The Weeknd',200,'blinding lights','the weeknd','x','plain','plain') RETURNING id`,
				[videoId]
			)
			return r.rows[0].id
		}

		async function seedRequest(videoId: string) {
			await pool.query(
				"INSERT INTO requested_songs (video_id, song, artist) VALUES ($1,'Blinding Lights','The Weeknd')",
				[videoId]
			)
		}

		it("resolves album art from a search by the lyric's song and artist", async () => {
			await seedLyric(ATV)
			const search = vi.fn(async () => [hit({ videoId: ATV })])
			expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBe(ALBUM_ART)
			expect(search).toHaveBeenCalledWith("Blinding Lights The Weeknd")
			expect((await getVideoArtwork(env, ATV))?.artworkUrl).toBe(ALBUM_ART)
		})

		it("resolves a requested song that has no lyric yet", async () => {
			await seedRequest(ATV)
			const search = async () => [hit({ videoId: ATV })]
			expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBe(ALBUM_ART)
		})

		it("resolves a linked video through its lyric", async () => {
			const id = await seedLyric(OMV)
			await pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2),($1,$3)",
				[id, OMV, ATV]
			)
			const search = async () => [hit({ videoId: ATV })]
			expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBe(ALBUM_ART)
		})

		describe("edge cases", () => {
			it("returns null for a video with no known song, without searching", async () => {
				const search = vi.fn(async () => [hit({ videoId: ATV })])
				expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBeNull()
				expect(search).not.toHaveBeenCalled()
			})

			it("ignores a deleted lyric", async () => {
				const id = await seedLyric(ATV)
				const user = await pool.query("INSERT INTO users (key_id) VALUES ('k') RETURNING id")
				await pool.query(
					"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'admin' WHERE id = $1",
					[id, user.rows[0].id]
				)
				const search = vi.fn(async () => [hit({ videoId: ATV })])
				expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBeNull()
				expect(search).not.toHaveBeenCalled()
			})

			it("returns null when the video is not among the search results", async () => {
				await seedLyric(ATV)
				const search = async () => [hit({ videoId: "dQw4w9WgXcQ" })]
				expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBeNull()
			})

			it("returns null for a music video, whose search thumbnail is not square album art", async () => {
				await seedLyric(OMV)
				const search = async () => [hit({ videoId: OMV, videoType: "video", artworkUrl: null })]
				expect(await resolveArtwork(env, OMV, { search, random: NEVER })).toBeNull()
			})
		})

		describe("regressions", () => {
			it("regression: resolves artwork without the player endpoint, which is LOGIN_REQUIRED from datacenter IPs", async () => {
				await seedLyric(ATV)
				const search = async () => [hit({ videoId: ATV })]
				expect(await resolveArtwork(env, ATV, { search, random: NEVER })).toBe(ALBUM_ART)
			})
		})
	})
})
