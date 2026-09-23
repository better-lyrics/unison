import { backfillFormatDetection } from "@/jobs/backfill-format-detection"
import { backfillLanguage } from "@/jobs/backfill-language"
import { backfillSyncType } from "@/jobs/backfill-synctype"
import {
	type IntegrationDb,
	describeIntegration,
	insertLegacyLyric,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { compress } from "@/utils/compression"
import { sha256Hex } from "@/utils/hash"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { backfillRevisions } from "./backfill-revisions"

const LRC = readRevisionFixture("amazing-grace.lrc")
const PLAIN = readRevisionFixture("amazing-grace.txt")

describeIntegration("backfillRevisions (integration)", () => {
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

	async function liveRevision(lyricsId: number) {
		const { rows } = await db.pool.query(
			`SELECT r.* FROM lyric_revisions r JOIN lyrics l ON l.current_revision_id = r.id
			 WHERE l.id = $1`,
			[lyricsId]
		)
		return rows[0]
	}

	it("gives every legacy lyric a live rev 1, deleted ones included", async () => {
		const owner = await seedUser(db, "a".repeat(64))
		const live = await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })
		const deleted = await insertLegacyLyric(db, owner, {
			lyrics: await compress(LRC),
			deleted: true,
		})

		expect(await backfillRevisions(db.env)).toEqual({ created: 2, failed: 0 })

		for (const id of [live, deleted]) {
			const revision = await liveRevision(id)
			expect(revision).toMatchObject({
				rev_no: 1,
				status: "live",
				author_id: owner,
				created_at: 1700000000,
				content_hash: sha256Hex(LRC),
			})
		}
	})

	describe("edge cases", () => {
		it("counts a row it cannot read as failed and moves on", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			await insertLegacyLyric(db, owner, { lyrics: "H4sIAAAAAAAAA-not-really-gzip" })
			const good = await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })
			expect(await backfillRevisions(db.env)).toEqual({ created: 1, failed: 1 })
			expect(await liveRevision(good)).toBeDefined()
		})
	})

	describe("invariants", () => {
		it("is idempotent", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			await insertLegacyLyric(db, owner, { lyrics: await compress(LRC) })
			await backfillRevisions(db.env)
			expect(await backfillRevisions(db.env)).toEqual({ created: 0, failed: 0 })
		})

		it("leaves the lyric's content and updated_at alone", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const stored = await compress(LRC)
			const id = await insertLegacyLyric(db, owner, { lyrics: stored })
			await backfillRevisions(db.env)
			const { rows } = await db.pool.query("SELECT lyrics, updated_at FROM lyrics WHERE id = $1", [
				id,
			])
			expect(rows[0]).toEqual({ lyrics: stored, updated_at: 1700000000 })
		})

		it("keeps the live revision in step when the format and sync type backfills correct a row", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await insertLegacyLyric(db, owner, {
				lyrics: await compress(LRC),
				format: "plain",
				syncType: "plain",
			})
			await backfillRevisions(db.env)
			await backfillFormatDetection(db.env)
			await backfillSyncType(db.env)
			const { rows } = await db.pool.query("SELECT format, sync_type FROM lyrics WHERE id = $1", [
				id,
			])
			expect(rows[0]).toEqual({ format: "lrc", sync_type: "linesync" })
			expect(await liveRevision(id)).toMatchObject({ format: "lrc", sync_type: "linesync" })
		})

		it("keeps the live revision in step when the language backfill detects a language", async () => {
			const owner = await seedUser(db, "a".repeat(64))
			const id = await insertLegacyLyric(db, owner, {
				lyrics: await compress(PLAIN),
				format: "plain",
				syncType: "plain",
				language: null,
			})
			await backfillRevisions(db.env)
			await backfillLanguage(db.env)
			const { rows } = await db.pool.query("SELECT language FROM lyrics WHERE id = $1", [id])
			expect(rows[0].language).toBe("en")
			expect((await liveRevision(id)).language).toBe("en")
		})
	})
})
