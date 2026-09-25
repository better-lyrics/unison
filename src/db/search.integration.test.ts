import { config } from "@/config"
import { searchByQuery } from "@/db/lyrics"
import { AUTO_HIDE_PREDICATE, fuzzyMatch } from "@/db/predicates"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { compress } from "@/utils/compression"
import { normalize, normalizeArtist, normalizeSong } from "@/utils/normalize"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const TRIGRAM_INDEXES = [
	"idx_lyrics_song_norm_trgm",
	"idx_lyrics_artist_norm_trgm",
	"idx_lyrics_album_norm_trgm",
	"idx_lyrics_song_artist_norm_trgm",
]

interface Fixture {
	videoId: string
	song: string
	artist: string
	album?: string
	isrc?: string
	text: string
}

const FIXTURES: Fixture[] = [
	{
		videoId: "dvgZkm1xWPE",
		song: "Viva La Vida",
		artist: "Coldplay",
		album: "Viva La Vida or Death and All His Friends",
		isrc: "GBAYE0800346",
		text: "I used to rule the world seas would rise when I gave the word",
	},
	{
		videoId: "G-cCUt6LQ8M",
		song: "Kyun Dhunde",
		artist: "Vilen",
		album: "Kyun Dhunde",
		text: "kyun dhunde tu mujhe har jagah",
	},
	{
		videoId: "fJ9rUzIMcZQ",
		song: "Bohemian Rhapsody",
		artist: "Queen",
		album: "A Night at the Opera",
		isrc: "GBUM71029604",
		text: "is this the real life is this just fantasy",
	},
	{
		videoId: "hTWKbfoikeg",
		song: "Smells Like Teen Spirit",
		artist: "Nirvana",
		album: "Nevermind",
		text: "load up on guns bring your friends",
	},
	{
		videoId: "Zi_XLOBDo_Y",
		song: "Billie Jean",
		artist: "Michael Jackson",
		album: "Thriller",
		text: "billie jean is not my lover she's just a girl",
	},
	{
		videoId: "SX_ViT4Ra7k",
		song: "夜に駆ける",
		artist: "YOASOBI",
		text: "沈むように溶けてゆくように",
	},
	{
		videoId: "kXYiU_JCYtU",
		song: "Numb",
		artist: "Linkin Park",
		album: "Meteora",
		text: "i'm tired of being what you want me to be",
	},
	{
		videoId: "YQHsXMglC9A",
		song: "Hello",
		artist: "Adele",
		album: "25",
		text: "hello it's me i was wondering",
	},
]

const QUERIES = [
	"viva la vida",
	"coldplay",
	"kyun dhunde",
	"vilen",
	"bohemian",
	"queen bohemian rhapsody",
	"night at the opera",
	"nirvana teen spirit",
	"billie jean michael jackson",
	"yoasobi",
	"夜に駆ける",
	"linkin park numb",
	"hello adele",
	"real life fantasy",
	"GBAYE0800346",
	"dvgZkm1xWPE",
	"completely unrelated words",
]

describeIntegration("searchByQuery (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	const ids = new Map<string, number>()

	const threshold = config.search.similarityThreshold

	async function insertFixture(f: Fixture): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, album, isrc, duration, song_norm, artist_norm, album_norm,
				 lyrics, format, sync_type, submitter_id, effective_score, upvotes, downvotes,
				 vote_count, lyrics_text_search)
			 VALUES ($1,$2,$3,$4,$5,200,$6,$7,$8,$9,'lrc','linesync',$10,1,0,0,1,
				to_tsvector('simple', $11))
			 RETURNING id`,
			[
				f.videoId,
				f.song,
				f.artist,
				f.album ?? null,
				f.isrc ?? null,
				normalizeSong(f.song),
				normalizeArtist(f.artist),
				f.album ? normalize(f.album) : null,
				await compress(f.text),
				submitter,
				f.text,
			]
		)
		return rows[0].id
	}

	async function legacyMatchIds(query: string): Promise<number[]> {
		const normalized = normalize(query)
		const { rows } = await db.pool.query<{ id: number }>(
			`SELECT id FROM lyrics
			 WHERE deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE} AND (
				video_id = $1 OR isrc = $1
				OR id IN (SELECT lyrics_id FROM lyrics_video_ids WHERE video_id = $1)
				OR similarity(song_norm, $2) > $3
				OR similarity(artist_norm, $2) > $3
				OR (album_norm IS NOT NULL AND similarity(album_norm, $2) > $3)
				OR similarity(song_norm || ' ' || artist_norm, $2) > $3
				OR lyrics_text_search @@ plainto_tsquery('simple', $1)
			 )
			 ORDER BY id`,
			[query.trim(), normalized, threshold]
		)
		return rows.map((r) => r.id)
	}

	const sortedIds = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b)

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.query("DELETE FROM lyrics_video_ids")
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM lyrics_video_ids")
		await wipeRevisionData(db)
		submitter = await seedUser(db, "searcher")
		ids.clear()
		for (const f of FIXTURES) ids.set(f.song, await insertFixture(f))
	})

	describe("matching", () => {
		it("finds a lyric by fuzzy song title", async () => {
			const results = await searchByQuery(db.env, "viva la vda", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Viva La Vida"))
		})

		it("finds a lyric by artist", async () => {
			const results = await searchByQuery(db.env, "linkin park", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Numb"))
		})

		it("finds a lyric by album", async () => {
			const results = await searchByQuery(db.env, "a night at the opera", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Bohemian Rhapsody"))
		})

		it("finds a lyric through the combined song and artist text", async () => {
			const results = await searchByQuery(db.env, "billie jean michael jackson", 20)
			expect(results[0].id).toBe(ids.get("Billie Jean"))
		})

		it("finds a lyric by its lyrics text", async () => {
			const results = await searchByQuery(db.env, "real life fantasy", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Bohemian Rhapsody"))
		})

		it("ranks an exact video id match first", async () => {
			const results = await searchByQuery(db.env, "dvgZkm1xWPE", 20)
			expect(results[0].id).toBe(ids.get("Viva La Vida"))
		})

		it("ranks an exact ISRC match first", async () => {
			const results = await searchByQuery(db.env, "GBUM71029604", 20)
			expect(results[0].id).toBe(ids.get("Bohemian Rhapsody"))
		})
	})

	describe("edge cases", () => {
		it("returns nothing for a query below the minimum length", async () => {
			expect(await searchByQuery(db.env, "a", 20)).toEqual([])
		})

		it("returns nothing for whitespace", async () => {
			expect(await searchByQuery(db.env, "   ", 20)).toEqual([])
		})

		it("returns nothing when nothing is similar", async () => {
			expect(await searchByQuery(db.env, "zzqxv wkkp", 20)).toEqual([])
		})

		it("matches a non-Latin title", async () => {
			const results = await searchByQuery(db.env, "夜に駆ける", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("夜に駆ける"))
		})

		it("treats LIKE wildcards and quotes as plain text", async () => {
			await expect(searchByQuery(db.env, "100% 'hello'_", 20)).resolves.toBeInstanceOf(Array)
		})

		it("respects the limit", async () => {
			expect((await searchByQuery(db.env, "viva", 50)).length).toBeGreaterThan(1)
			expect(await searchByQuery(db.env, "viva", 1)).toHaveLength(1)
		})

		it("skips deleted lyrics", async () => {
			await db.pool.query(
				`UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2,
					deleted_by_role = 'submitter' WHERE id = $1`,
				[ids.get("Numb"), submitter]
			)
			const results = await searchByQuery(db.env, "linkin park numb", 20)
			expect(results.map((r) => r.id)).not.toContain(ids.get("Numb"))
		})
	})

	describe("invariants", () => {
		it("returns exactly the rows the unfiltered similarity checks match", async () => {
			for (const query of QUERIES) {
				const results = await searchByQuery(db.env, query, 100)
				expect(sortedIds(results), query).toEqual(await legacyMatchIds(query))
			}
		})

		it("returns the same rows in the same order on repeat calls", async () => {
			const first = await searchByQuery(db.env, "coldplay viva", 20)
			const second = await searchByQuery(db.env, "coldplay viva", 20)
			expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id))
		})

		it("leaves the session threshold untouched for other queries", async () => {
			await searchByQuery(db.env, "viva la vida", 20)
			const { rows } = await db.pool.query<{ t: string | null }>(
				"SELECT current_setting('pg_trgm.similarity_threshold', true) AS t"
			)
			expect(rows[0].t === null ? null : Number(rows[0].t)).not.toBe(threshold)
		})

		it("returns every pooled connection after concurrent searches", async () => {
			await Promise.all(QUERIES.map((q) => searchByQuery(db.env, q, 20)))
			expect(db.pool.idleCount).toBe(db.pool.totalCount)
		})
	})

	describe("error paths", () => {
		it("rejects on a database error and keeps later searches working", async () => {
			await expect(searchByQuery(db.env, "bad\u0000query", 20)).rejects.toThrow()
			const results = await searchByQuery(db.env, "coldplay", 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Viva La Vida"))
		})
	})

	describe("regressions", () => {
		it("regression: matches titles between the search threshold and pg_trgm's 0.3 default", async () => {
			const query = "teen"
			const { rows } = await db.pool.query<{ s: number }>(
				`SELECT GREATEST(similarity(song_norm, $1), similarity(artist_norm, $1),
					COALESCE(similarity(album_norm, $1), 0), similarity(song_norm || ' ' || artist_norm, $1)) AS s
				 FROM lyrics WHERE id = $2`,
				[normalize(query), ids.get("Smells Like Teen Spirit")]
			)
			expect(rows[0].s).toBeGreaterThan(threshold)
			expect(rows[0].s).toBeLessThan(0.3)
			const results = await searchByQuery(db.env, query, 20)
			expect(results.map((r) => r.id)).toContain(ids.get("Smells Like Teen Spirit"))
		})

		it("regression: the fuzzy tier can use trigram indexes instead of scanning lyrics", async () => {
			const client = await db.pool.connect()
			try {
				await client.query("BEGIN")
				await client.query("SET LOCAL enable_seqscan = off")
				await client.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [
					String(threshold),
				])
				const match = fuzzyMatch(normalize("viva la vida"), threshold)
				let n = 0
				const sql = `EXPLAIN SELECT id FROM lyrics WHERE ${match.sql}`.replace(
					/\?/g,
					() => `$${++n}`
				)
				const params = match.params
				const { rows } = await client.query(sql, params)
				const plan = rows.map((r) => r["QUERY PLAN"]).join("\n")
				expect(plan).not.toMatch(/Seq Scan on lyrics/)
				for (const index of TRIGRAM_INDEXES) expect(plan).toContain(index)
			} finally {
				await client.query("ROLLBACK")
				client.release()
			}
		})

		it("regression: trigram indexes skip the GIN pending list", async () => {
			const { rows } = await db.pool.query<{ relname: string; reloptions: string[] | null }>(
				"SELECT relname, reloptions FROM pg_class WHERE relname = ANY($1) ORDER BY relname",
				[TRIGRAM_INDEXES]
			)
			expect(rows.map((r) => r.relname)).toEqual([...TRIGRAM_INDEXES].sort())
			for (const row of rows) expect(row.reloptions, row.relname).toContain("fastupdate=off")
		})
	})
})
