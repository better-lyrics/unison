import {
	type IntegrationDb,
	describeIntegration,
	insertLegacyLyric,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { compress, decompress } from "@/utils/compression"
import { sha256Hex } from "@/utils/hash"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	ensureBaseRevision,
	getRevisionBar,
	getRevisionRow,
	insertRevision,
	retireLiveRevision,
	setCurrentRevision,
	supersedePending,
} from "./lyric-revisions"

const LRC = readRevisionFixture("amazing-grace.lrc")
const TTML = readRevisionFixture("amazing-grace.ttml")

describeIntegration("lyric revisions store (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
	})

	it("gives a new submission a live rev 1 that is both current and anchor", async () => {
		const owner = await seedUser(db, "a".repeat(64))
		const id = await seedLyric(db, owner, { lyrics: TTML, format: "ttml" })

		const { rows } = await db.pool.query(
			`SELECT l.current_revision_id, l.anchor_revision_id, r.id, r.rev_no, r.status,
				r.author_id, r.content_hash, r.format, r.sync_type, r.language
			 FROM lyrics l JOIN lyric_revisions r ON r.lyrics_id = l.id WHERE l.id = $1`,
			[id]
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			rev_no: 1,
			status: "live",
			author_id: owner,
			content_hash: sha256Hex(TTML),
			format: "ttml",
			sync_type: "richsync",
			language: "en",
		})
		expect(rows[0].current_revision_id).toBe(rows[0].id)
		expect(rows[0].anchor_revision_id).toBe(rows[0].id)
	})

	it("materializes rev 1 for a lyric stored before revisions existed", async () => {
		const owner = await seedUser(db, "a".repeat(64))
		const id = await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })

		await ensureBaseRevision(db.env.DB, id)

		const { rows } = await db.pool.query(
			"SELECT id, rev_no, status, author_id, created_at, content_hash FROM lyric_revisions WHERE lyrics_id = $1",
			[id]
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			rev_no: 1,
			status: "live",
			author_id: owner,
			created_at: 1700000000,
			content_hash: sha256Hex(LRC),
		})
	})

	it("returns a synthetic rev 1 bar for a lyric without revisions", async () => {
		const owner = await seedUser(db, "a".repeat(64))
		const id = await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })
		expect(await getRevisionBar(db.env.DB, { id, created_at: 1700000000 })).toEqual({
			revNo: 1,
			count: 1,
			pending: null,
			lastRejected: null,
			updatedAt: 1700000000,
		})
	})

	it("writes the live revision into the lyric's content columns", async () => {
		const owner = await seedUser(db, "a".repeat(64))
		const id = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
		const edited = LRC.replace("wretch", "soul")

		await db.env.DB.transaction(async (tx) => {
			await retireLiveRevision(tx, id)
			const revision = await insertRevision(tx, {
				lyricsId: id,
				content: edited,
				format: "lrc",
				syncType: "linesync",
				language: "ja",
				isrc: "USRC17607839",
				authorId: owner,
				status: "live",
				pendingReason: null,
				textDrift: 0.01,
				timingDrift: 0,
				jevProbability: null,
				revertsRevisionId: null,
			})
			await setCurrentRevision(tx, revision)
		})

		const { rows } = await db.pool.query(
			`SELECT lyrics, language, isrc, language_source, current_revision_id,
				lyrics_text_search @@ plainto_tsquery('simple', 'soul') AS indexed
			 FROM lyrics WHERE id = $1`,
			[id]
		)
		expect(await decompress(rows[0].lyrics)).toBe(edited)
		expect(rows[0]).toMatchObject({
			language: "ja",
			isrc: "USRC17607839",
			language_source: "submitter",
			indexed: true,
		})
		const live = await getRevisionRow(db.env.DB, id, rows[0].current_revision_id)
		expect(live?.rev_no).toBe(2)
	})

	describe("edge cases", () => {
		it("materializes rev 1 from uncompressed legacy content", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await insertLegacyLyric(db, owner, { lyrics: LRC })
			await ensureBaseRevision(db.env.DB, id)
			const { rows } = await db.pool.query(
				"SELECT lyrics FROM lyric_revisions WHERE lyrics_id = $1",
				[id]
			)
			expect(await decompress(rows[0].lyrics)).toBe(LRC)
		})

		it("does nothing for a missing lyric", async () => {
			await expect(ensureBaseRevision(db.env.DB, 999_999)).resolves.toBeUndefined()
		})
	})

	describe("regressions", () => {
		it("regression: the edit-as-variant parent_id column is gone", async () => {
			const { rows } = await db.pool.query(
				"SELECT 1 FROM information_schema.columns WHERE table_name = 'lyrics' AND column_name = 'parent_id'"
			)
			expect(rows).toHaveLength(0)
		})

		it("regression: deleting a lyric removes its revisions instead of failing", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
			await db.pool.query("DELETE FROM lyrics WHERE id = $1", [id])
			const { rows } = await db.pool.query(
				"SELECT count(*)::int AS n FROM lyric_revisions WHERE lyrics_id = $1",
				[id]
			)
			expect(rows[0].n).toBe(0)
		})
	})

	describe("invariants", () => {
		it("is idempotent under concurrent calls", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })
			await Promise.all([
				ensureBaseRevision(db.env.DB, id),
				ensureBaseRevision(db.env.DB, id),
				ensureBaseRevision(db.env.DB, id),
			])
			const { rows } = await db.pool.query(
				"SELECT count(*)::int AS n FROM lyric_revisions WHERE lyrics_id = $1",
				[id]
			)
			expect(rows[0].n).toBe(1)
		})

		it("rejects a second live revision for the same lyric", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
			await expect(
				db.env.DB.transaction((tx) =>
					insertRevision(tx, {
						lyricsId: id,
						content: LRC.replace("wretch", "soul"),
						format: "lrc",
						syncType: "linesync",
						language: "en",
						isrc: null,
						authorId: owner,
						status: "live",
						pendingReason: null,
						textDrift: 0,
						timingDrift: 0,
						jevProbability: null,
						revertsRevisionId: null,
					})
				)
			).rejects.toThrow(/idx_lyric_revisions_one_live/)
		})

		it("numbers revisions without gaps", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
			for (const word of ["soul", "heart"]) {
				await db.env.DB.transaction(async (tx) => {
					await supersedePending(tx, id)
					await insertRevision(tx, {
						lyricsId: id,
						content: LRC.replace("wretch", word),
						format: "lrc",
						syncType: "linesync",
						language: "en",
						isrc: null,
						authorId: owner,
						status: "pending",
						pendingReason: "large_text_drift",
						textDrift: 0.2,
						timingDrift: 0,
						jevProbability: null,
						revertsRevisionId: null,
					})
				})
			}
			const { rows } = await db.pool.query<{ rev_no: number; status: string }>(
				"SELECT rev_no, status FROM lyric_revisions WHERE lyrics_id = $1 ORDER BY rev_no",
				[id]
			)
			expect(rows).toEqual([
				{ rev_no: 1, status: "live" },
				{ rev_no: 2, status: "superseded" },
				{ rev_no: 3, status: "pending" },
			])
		})
	})
})
