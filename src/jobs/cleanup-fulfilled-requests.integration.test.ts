import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { cleanupFulfilledRequests } from "./cleanup-fulfilled-requests"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const HOME = "dQw4w9WgXcQ"
const LINKED = "9bZkp7q19f0"
const UNSERVED = "kXYiU_JCYtU"

describeIntegration(
	"cleanupFulfilledRequests routes through the video link junction (integration)",
	() => {
		const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
		let pool: pg.Pool
		let env: Env

		beforeAll(async () => {
			if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
			pool = new Pool({ connectionString: url })
			const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
			await pool.query(schema)
			env = { DB: new D1Compat(pool) } as unknown as Env
		})

		afterAll(async () => {
			await pool.end()
		})

		beforeEach(async () => {
			for (const table of [
				"lyrics_video_ids",
				"request_fulfillments",
				"lyrics_requests",
				"requested_songs",
				"lyrics",
				"users",
			]) {
				await pool.query(`DELETE FROM ${table}`)
			}
		})

		async function seedSyncedLyricLinkedTo(homeId: string, linkedId: string): Promise<void> {
			const u = await pool.query("INSERT INTO users (key_id) VALUES ('k') RETURNING id")
			const r = await pool.query(
				`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id)
			 VALUES ($1,'Song','Artist',180,'song','artist','x','lrc','linesync',$2) RETURNING id`,
				[homeId, u.rows[0].id]
			)
			await pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2),($1,$3)",
				[r.rows[0].id, homeId, linkedId]
			)
		}

		async function seedRequest(videoId: string): Promise<void> {
			await pool.query("INSERT INTO requested_songs (video_id, song, artist) VALUES ($1,'s','a')", [
				videoId,
			])
			await pool.query(
				"INSERT INTO lyrics_requests (video_id, requester_id, requester_type) VALUES ($1,'req','extension')",
				[videoId]
			)
		}

		const requestCount = async (videoId: string): Promise<number> =>
			Number(
				(
					await pool.query("SELECT count(*)::int n FROM lyrics_requests WHERE video_id = $1", [
						videoId,
					])
				).rows[0].n
			)

		it("purges a request whose video is served only through a link", async () => {
			await seedSyncedLyricLinkedTo(HOME, LINKED)
			await seedRequest(LINKED)
			await seedRequest(UNSERVED)

			const { deleted } = await cleanupFulfilledRequests(env)

			expect(deleted).toBe(1)
			expect(await requestCount(LINKED)).toBe(0)
			expect(await requestCount(UNSERVED)).toBe(1)
		})
	}
)
