import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getMostWantedPage, getSongLeaderboard } from "./leaderboard"
import { createRequest } from "./requests"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const HOME = "dQw4w9WgXcQ"
const LINKED = "9bZkp7q19f0"

describeIntegration("demand routes through the video link junction (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = {
			DB: new D1Compat(pool),
			CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		for (const table of [
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
	})

	async function seedSyncedLyricLinkedTo(homeId: string, linkedId: string): Promise<void> {
		const u = await pool.query("INSERT INTO users (key_id) VALUES ('k') RETURNING id")
		const userId = u.rows[0].id
		const r = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1,'Song','Artist',180,'song','artist','x','lrc','linesync',$2) RETURNING id`,
			[homeId, userId]
		)
		const lyricId = r.rows[0].id
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2),($1,$3)", [
			lyricId,
			homeId,
			linkedId,
		])
	}

	it("treats a video served only through a link as already available", async () => {
		await seedSyncedLyricLinkedTo(HOME, LINKED)
		const res = await createRequest(env, {
			videoId: LINKED,
			song: "Song",
			artist: "Artist",
			thumbnailUrl: null,
			requesterId: "requester-1",
			requesterType: "extension",
			weight: 1,
		})
		expect(res.status).toBe("already_available")
	})

	it("excludes a linked-served video from most-wanted", async () => {
		const created = await createRequest(env, {
			videoId: LINKED,
			song: "Song",
			artist: "Artist",
			thumbnailUrl: null,
			requesterId: "requester-1",
			requesterType: "extension",
			weight: 1,
		})
		expect(created.status).not.toBe("already_available")

		const before = await getMostWantedPage(env, null, 50)
		expect(before.items.map((i) => i.videoId)).toContain(LINKED)

		await seedSyncedLyricLinkedTo(HOME, LINKED)

		const after = await getMostWantedPage(env, null, 50)
		expect(after.items.map((i) => i.videoId)).not.toContain(LINKED)
	})

	describe("getSongLeaderboard (home page most-wanted)", () => {
		it("excludes a video already served through its primary upload", async () => {
			await createRequest(env, {
				videoId: HOME,
				song: "Song",
				artist: "Artist",
				thumbnailUrl: null,
				requesterId: "requester-1",
				requesterType: "extension",
				weight: 1,
			})

			const before = await getSongLeaderboard(env, 50)
			expect(before.mostWanted.map((r) => r.videoId)).toContain(HOME)

			await seedSyncedLyricLinkedTo(HOME, LINKED)

			const after = await getSongLeaderboard(env, 50)
			expect(after.mostWanted.map((r) => r.videoId)).not.toContain(HOME)
		})

		it("excludes a video served only through a link", async () => {
			await createRequest(env, {
				videoId: LINKED,
				song: "Song",
				artist: "Artist",
				thumbnailUrl: null,
				requesterId: "requester-1",
				requesterType: "extension",
				weight: 1,
			})

			const before = await getSongLeaderboard(env, 50)
			expect(before.mostWanted.map((r) => r.videoId)).toContain(LINKED)

			await seedSyncedLyricLinkedTo(HOME, LINKED)

			const after = await getSongLeaderboard(env, 50)
			expect(after.mostWanted.map((r) => r.videoId)).not.toContain(LINKED)
		})
	})
})
