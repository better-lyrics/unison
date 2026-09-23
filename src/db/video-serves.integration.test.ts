import { readFileSync } from "node:fs"
import { videoServesExpr } from "@/db/predicates"
import { compress } from "@/utils/compression"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const HOME_VIDEO = "dQw4w9WgXcQ"
const LINKED_VIDEO = "9bZkp7q19f0"
const OTHER_VIDEO = "kJQP7kiw5Fk"

describeIntegration("videoServesExpr (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let sample: string

	const toPg = (sql: string) => {
		let n = 0
		return sql.replace(/\?/g, () => `$${++n}`)
	}
	const servedIds = async (videoId: string, prefix: "" | "l." = "l."): Promise<number[]> => {
		const sql =
			prefix === "l."
				? `SELECT l.id FROM lyrics l WHERE ${videoServesExpr("l.")} AND l.deleted_at IS NULL ORDER BY l.id`
				: `SELECT id FROM lyrics WHERE ${videoServesExpr()} AND deleted_at IS NULL ORDER BY id`
		const { rows } = await pool.query(toPg(sql), [videoId, videoId])
		return rows.map((r) => r.id as number)
	}

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		sample = await compress("never gonna give you up\nnever gonna let you down")
	})

	afterAll(async () => {
		await pool.end()
	})

	let submitter: number
	let home: number
	let linkedOnly: number
	let other: number

	async function insertLyric(videoId: string, deleted = false): Promise<number> {
		const { rows } = await pool.query(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, effective_score, upvotes, downvotes, vote_count,
				 deleted_at, deleted_by_user_id, deleted_by_role)
			 VALUES ($1,'Song','Artist',180,'song','artist',$2,'lrc','linesync',$3,1,0,0,1,$4,$5,$6)
			 RETURNING id`,
			[
				videoId,
				sample,
				submitter,
				deleted ? Math.floor(Date.now() / 1000) : null,
				deleted ? submitter : null,
				deleted ? "submitter" : null,
			]
		)
		return rows[0].id
	}

	beforeEach(async () => {
		await pool.query("DELETE FROM lyrics_video_ids")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
		submitter = (await pool.query("INSERT INTO users (key_id) VALUES ('owner') RETURNING id"))
			.rows[0].id
		home = await insertLyric(HOME_VIDEO)
		linkedOnly = await insertLyric(OTHER_VIDEO)
		other = await insertLyric(OTHER_VIDEO)
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
			linkedOnly,
			LINKED_VIDEO,
		])
	})

	describe("matching", () => {
		it("serves a lyric whose home video_id matches", async () => {
			expect(await servedIds(HOME_VIDEO)).toEqual([home])
		})

		it("serves a lyric linked to the video through lyrics_video_ids", async () => {
			expect(await servedIds(LINKED_VIDEO)).toEqual([linkedOnly])
		})

		it("works with the unprefixed form", async () => {
			expect(await servedIds(LINKED_VIDEO, "")).toEqual([linkedOnly])
			expect(await servedIds(HOME_VIDEO, "")).toEqual([home])
		})
	})

	describe("edge cases", () => {
		it("serves nothing for an unknown video", async () => {
			expect(await servedIds("zzzzzzzzzzz")).toEqual([])
		})

		it("serves nothing for an empty video id", async () => {
			expect(await servedIds("")).toEqual([])
		})

		it("keeps the caller's deleted_at filter in charge", async () => {
			await insertLyric(HOME_VIDEO, true)
			expect(await servedIds(HOME_VIDEO)).toEqual([home])
		})
	})

	describe("invariants", () => {
		it("returns a lyric once when it matches by home video and by link", async () => {
			await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
				home,
				HOME_VIDEO,
			])
			expect(await servedIds(HOME_VIDEO)).toEqual([home])
		})

		it("serves every lyric on the video, not just one", async () => {
			expect(await servedIds(OTHER_VIDEO)).toEqual([linkedOnly, other])
		})
	})

	describe("regressions", () => {
		it("regression: the video lookup joined with users plans without sequential scans", async () => {
			await pool.query(
				`INSERT INTO users (key_id) SELECT 'bulk-' || g FROM generate_series(1, 20000) g`
			)
			await pool.query(
				`INSERT INTO lyrics
					(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
					 submitter_id, effective_score, upvotes, downvotes, vote_count)
				 SELECT 'bulk' || lpad(g::text, 7, '0'), 'Song', 'Artist', 180, 'song', 'artist', $1,
					'lrc', 'linesync', $2, 1, 0, 0, 1
				 FROM generate_series(1, 5000) g`,
				[sample, submitter]
			)
			await pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) SELECT id, video_id FROM lyrics"
			)
			await pool.query("ANALYZE lyrics")
			await pool.query("ANALYZE users")
			await pool.query("ANALYZE lyrics_video_ids")

			const { rows } = await pool.query(
				toPg(
					`EXPLAIN SELECT l.*, u.nickname FROM lyrics l
					 LEFT JOIN users u ON l.submitter_id = u.id
					 WHERE ${videoServesExpr("l.")} AND l.deleted_at IS NULL`
				),
				[HOME_VIDEO, HOME_VIDEO]
			)
			const plan = rows.map((r) => r["QUERY PLAN"]).join("\n")
			expect(plan).not.toMatch(/Seq Scan on (lyrics|users|lyrics_video_ids)\s/)
		})
	})
})
