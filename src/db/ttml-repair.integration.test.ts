import { ensureBaseRevision } from "@/db/lyric-revisions"
import { insertOpenCase } from "@/db/report-cases"
import { saveRevision } from "@/services/lyric-revisions"
import {
	type IntegrationDb,
	describeIntegration,
	insertLegacyLyric,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readMalformedTtml, readRevisionFixture } from "@/test/lyric-fixtures"
import { compress, decompress } from "@/utils/compression"
import { repairTtml } from "@/utils/ttml-repair"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	TTML_REPAIR_DELETION_REASON,
	applyTtmlRepairs,
	planTtmlRepairs,
	revertTtmlRepairs,
} from "./ttml-repair"

describeIntegration("stored TTML repair (integration)", () => {
	let db: IntegrationDb
	let owner: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		owner = await seedUser(db, "a".repeat(64))
	})

	async function seedTtml(content: string, opts: { deleted?: boolean } = {}): Promise<number> {
		return insertLegacyLyric(db, owner, {
			lyrics: await compress(content),
			format: "ttml",
			syncType: "richsync",
			deleted: opts.deleted,
		})
	}

	async function lyricRow(id: number) {
		const { rows } = await db.pool.query(
			`SELECT lyrics, current_revision_id, anchor_revision_id, deleted_at, deleted_by_user_id,
				deleted_by_role, deletion_reason
			FROM lyrics WHERE id = $1`,
			[id]
		)
		return rows[0]
	}

	async function revisions(id: number) {
		const { rows } = await db.pool.query(
			"SELECT id, rev_no, status, author_id FROM lyric_revisions WHERE lyrics_id = $1 ORDER BY rev_no",
			[id]
		)
		return rows
	}

	describe("plan", () => {
		it("repairs what repairTtml can fix and deletes the rest", async () => {
			const fixable = await seedTtml(readMalformedTtml("text-before-root"))
			const broken = await seedTtml(readMalformedTtml("control-char"))
			const actions = await planTtmlRepairs(db.env)
			expect(actions.map(({ kind, lyricsId }) => ({ kind, lyricsId }))).toEqual([
				{ kind: "repair", lyricsId: fixable },
				{ kind: "delete", lyricsId: broken },
			])
			const repair = actions[0]
			expect(repair.kind === "repair" && repair.after).toBe(
				repairTtml(readMalformedTtml("text-before-root"))
			)
		})

		it("ignores well-formed, deleted and non-TTML rows", async () => {
			await seedTtml(readRevisionFixture("amazing-grace.ttml"))
			await seedTtml(readMalformedTtml("code-fence"), { deleted: true })
			await insertLegacyLyric(db, owner, { lyrics: readMalformedTtml("code-fence"), format: "lrc" })
			expect(await planTtmlRepairs(db.env)).toEqual([])
		})

		describe("edge cases", () => {
			it("skips a delete when the lyric has an open report case", async () => {
				const flagged = await seedTtml(readMalformedTtml("mismatched-tag"))
				await insertOpenCase(db.env.DB, flagged)
				expect(await planTtmlRepairs(db.env)).toMatchObject([
					{ kind: "skip", lyricsId: flagged, reason: "open_report_case" },
				])
			})

			it("skips a row with no submitter", async () => {
				const orphan = await seedTtml(readMalformedTtml("code-fence"))
				await db.pool.query("UPDATE lyrics SET submitter_id = NULL WHERE id = $1", [orphan])
				expect(await planTtmlRepairs(db.env)).toMatchObject([
					{ kind: "skip", lyricsId: orphan, reason: "no_submitter" },
				])
			})

			it("regression: skips a lyric with a pending edit so approval cannot overwrite the repair", async () => {
				const id = await seedTtml(readMalformedTtml("code-fence"))
				await ensureBaseRevision(db.env.DB, id)
				await db.pool.query(
					`INSERT INTO lyric_revisions (lyrics_id, rev_no, lyrics, format, sync_type, content_hash,
						author_id, status, pending_reason)
					VALUES ($1, 2, $2, 'ttml', 'richsync', 'x', $3, 'pending', 'large_text_drift')`,
					[id, await compress(readRevisionFixture("amazing-grace.ttml")), owner]
				)
				expect(await planTtmlRepairs(db.env)).toMatchObject([
					{ kind: "skip", lyricsId: id, reason: "pending_revision" },
				])
			})

			it("pages through more rows than one batch", async () => {
				const ids: number[] = []
				for (let i = 0; i < 5; i++) ids.push(await seedTtml(readMalformedTtml("code-fence")))
				const actions = await planTtmlRepairs(db.env, { batchSize: 2 })
				expect(actions.map((a) => a.lyricsId)).toEqual(ids)
			})
		})
	})

	describe("apply", () => {
		it("makes the repaired file a new live revision authored by the submitter", async () => {
			const id = await seedTtml(readMalformedTtml("code-fence"))
			const original = (await lyricRow(id)).lyrics
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))

			const revs = await revisions(id)
			expect(revs.map(({ rev_no, status }) => ({ rev_no, status }))).toEqual([
				{ rev_no: 1, status: "past" },
				{ rev_no: 2, status: "live" },
			])
			expect(revs[1].author_id).toBe(owner)
			const row = await lyricRow(id)
			expect(await decompress(row.lyrics)).toBe(repairTtml(readMalformedTtml("code-fence")))
			expect(row.current_revision_id).toBe(revs[1].id)
			expect(row.anchor_revision_id).toBe(revs[0].id)
			expect(manifest).toEqual([
				{
					kind: "repair",
					lyricsId: id,
					previousRevisionId: revs[0].id,
					previousAnchorId: revs[0].id,
					repairRevisionId: revs[1].id,
					previous: expect.objectContaining({ lyrics: original, format: "ttml" }),
				},
			])
		})

		it("soft-deletes as system with no reputation or XP change", async () => {
			const id = await seedTtml(readMalformedTtml("half-written-tag"))
			const before = await db.pool.query("SELECT reputation FROM users WHERE id = $1", [owner])
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))

			const row = await lyricRow(id)
			expect(row.deleted_at).not.toBeNull()
			expect(row.deleted_by_role).toBe("system")
			expect(row.deletion_reason).toBe(TTML_REPAIR_DELETION_REASON)
			const after = await db.pool.query("SELECT reputation FROM users WHERE id = $1", [owner])
			expect(after.rows[0].reputation).toBe(before.rows[0].reputation)
			const xp = await db.pool.query("SELECT count(*)::int AS n FROM contribution_events")
			expect(xp.rows[0].n).toBe(0)
			expect(manifest).toEqual([{ kind: "delete", lyricsId: id }])
		})

		it("leaves skipped rows and their open report case untouched", async () => {
			const id = await seedTtml(readMalformedTtml("mismatched-tag"))
			await insertOpenCase(db.env.DB, id)
			expect(await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))).toEqual([])
			expect((await lyricRow(id)).deleted_at).toBeNull()
			const cases = await db.pool.query("SELECT status FROM report_cases WHERE lyrics_id = $1", [
				id,
			])
			expect(cases.rows).toEqual([{ status: "open" }])
		})

		describe("error paths", () => {
			it("skips a row whose content changed after the plan", async () => {
				const id = await seedTtml(readMalformedTtml("code-fence"))
				const plan = await planTtmlRepairs(db.env)
				await db.pool.query("UPDATE lyrics SET lyrics = $2 WHERE id = $1", [
					id,
					await compress(readMalformedTtml("trailing-junk")),
				])
				expect(await applyTtmlRepairs(db.env, plan)).toEqual([])
				expect(await revisions(id)).toEqual([])
			})

			it("skips a delete for a row deleted after the plan", async () => {
				const id = await seedTtml(readMalformedTtml("control-char"))
				const plan = await planTtmlRepairs(db.env)
				await db.pool.query(
					"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
					[id, owner]
				)
				expect(await applyTtmlRepairs(db.env, plan)).toEqual([])
				expect((await lyricRow(id)).deleted_by_role).toBe("submitter")
			})

			it("regression: refuses a plan whose repaired text was edited by hand", async () => {
				const id = await seedTtml(readMalformedTtml("code-fence"))
				const plan = (await planTtmlRepairs(db.env)).map((action) =>
					action.kind === "repair" ? { ...action, after: "<tt><body/></tt>" } : action
				)
				expect(await applyTtmlRepairs(db.env, plan)).toEqual([])
				expect(await revisions(id)).toEqual([])
			})
		})
	})

	describe("revert", () => {
		it("restores a repaired lyric byte for byte", async () => {
			const id = await seedTtml(readMalformedTtml("unbound-prefix"))
			const original = (await lyricRow(id)).lyrics
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))

			expect(await revertTtmlRepairs(db.env, manifest)).toEqual({ reverted: 1, skipped: [] })
			const row = await lyricRow(id)
			expect(row.lyrics).toBe(original)
			const revs = await revisions(id)
			expect(revs.map(({ rev_no, status }) => ({ rev_no, status }))).toEqual([
				{ rev_no: 1, status: "live" },
			])
			expect(row.current_revision_id).toBe(revs[0].id)
			expect(row.anchor_revision_id).toBe(revs[0].id)
		})

		it("undeletes a soft-deleted lyric", async () => {
			const id = await seedTtml(readMalformedTtml("bare-ampersand"))
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			expect(await revertTtmlRepairs(db.env, manifest)).toEqual({ reverted: 1, skipped: [] })
			expect(await lyricRow(id)).toMatchObject({
				deleted_at: null,
				deleted_by_user_id: null,
				deleted_by_role: null,
				deletion_reason: null,
			})
		})

		it("skips a lyric edited after the repair", async () => {
			const id = await seedTtml(readMalformedTtml("code-fence"))
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			const saved = await saveRevision(db.env, id, owner, {
				lyrics: repairTtml(readMalformedTtml("code-fence"))!.replace(">gual<", ">guar<"),
				format: "ttml",
			})
			expect(saved).toMatchObject({ ok: true, revision: { status: "live" } })
			expect(await revertTtmlRepairs(db.env, manifest)).toEqual({ reverted: 0, skipped: [id] })
		})

		it("skips an undelete for a lyric deleted again by someone else", async () => {
			const id = await seedTtml(readMalformedTtml("control-char"))
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			await db.pool.query(
				"UPDATE lyrics SET deleted_by_role = 'admin', deletion_reason = 'spam' WHERE id = $1",
				[id]
			)
			expect(await revertTtmlRepairs(db.env, manifest)).toEqual({ reverted: 0, skipped: [id] })
			expect((await lyricRow(id)).deleted_by_role).toBe("admin")
		})
	})

	describe("regressions: rehearsal on production rows", () => {
		const CONTENT_COLUMNS = `lyrics, format, sync_type, isrc, album, album_norm, language,
			language_source, language_detector_version, lyrics_text_search::text AS search, updated_at`

		async function contentColumns(id: number) {
			const { rows } = await db.pool.query(`SELECT ${CONTENT_COLUMNS} FROM lyrics WHERE id = $1`, [
				id,
			])
			return rows[0]
		}

		async function seedEditedMetadata(): Promise<number> {
			const id = await seedTtml(readMalformedTtml("code-fence"))
			await ensureBaseRevision(db.env.DB, id)
			await db.pool.query(
				`UPDATE lyrics SET album = 'Approved Album', album_norm = 'approved album',
					language = 'es', language_source = 'detector', language_detector_version = 4,
					lyrics_text_search = to_tsvector('simple', 'indexed by an older extractor'),
					updated_at = 1700000500
				WHERE id = $1`,
				[id]
			)
			return id
		}

		it("regression: apply keeps the lyric's album and detected language", async () => {
			const id = await seedEditedMetadata()
			await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			expect(await contentColumns(id)).toMatchObject({
				album: "Approved Album",
				language: "es",
				language_source: "detector",
				language_detector_version: 4,
			})
		})

		it("regression: revert restores the lyric content exactly", async () => {
			const id = await seedEditedMetadata()
			const { updated_at: _, ...before } = await contentColumns(id)
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			await revertTtmlRepairs(db.env, manifest)
			const { updated_at: __, ...after } = await contentColumns(id)
			expect(after).toEqual(before)
		})

		it("regression: revert keeps metadata approved after the repair", async () => {
			const id = await seedEditedMetadata()
			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			await db.pool.query(
				"UPDATE lyrics SET album = 'Later Album', album_norm = 'later album' WHERE id = $1",
				[id]
			)
			await revertTtmlRepairs(db.env, manifest)
			expect(await contentColumns(id)).toMatchObject({
				album: "Later Album",
				album_norm: "later album",
			})
		})
	})

	describe("cross-field interactions", () => {
		it("restores the live revision and a different anchor through apply and revert", async () => {
			const id = await seedTtml(readMalformedTtml("text-before-root"))
			await ensureBaseRevision(db.env.DB, id)
			const [base] = await revisions(id)
			const edited = await compress(readMalformedTtml("trailing-junk"))
			const { rows } = await db.pool.query(
				`INSERT INTO lyric_revisions (lyrics_id, rev_no, lyrics, format, sync_type, content_hash,
					author_id, status)
				VALUES ($1, 2, $2, 'ttml', 'richsync', 'x', $3, 'past') RETURNING id`,
				[id, edited, owner]
			)
			await db.pool.query("UPDATE lyric_revisions SET status = 'past' WHERE id = $1", [base.id])
			await db.pool.query("UPDATE lyric_revisions SET status = 'live' WHERE id = $1", [rows[0].id])
			await db.pool.query("UPDATE lyrics SET lyrics = $2, current_revision_id = $3 WHERE id = $1", [
				id,
				edited,
				rows[0].id,
			])
			const before = await lyricRow(id)

			const manifest = await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			expect(manifest).toMatchObject([
				{ kind: "repair", previousRevisionId: rows[0].id, previousAnchorId: base.id },
			])
			expect((await lyricRow(id)).anchor_revision_id).toBe(base.id)
			await revertTtmlRepairs(db.env, manifest)

			const after = await lyricRow(id)
			expect(after.lyrics).toBe(before.lyrics)
			expect(after.current_revision_id).toBe(rows[0].id)
			expect(after.anchor_revision_id).toBe(base.id)
			expect((await revisions(id)).map((r) => r.status)).toEqual(["past", "live"])
		})
	})

	describe("invariants", () => {
		it("finds nothing to do after an apply", async () => {
			await seedTtml(readMalformedTtml("code-fence"))
			await seedTtml(readMalformedTtml("control-char"))
			await applyTtmlRepairs(db.env, await planTtmlRepairs(db.env))
			expect(await planTtmlRepairs(db.env)).toEqual([])
		})

		it("plans the same actions again after a revert", async () => {
			await seedTtml(readMalformedTtml("code-fence"))
			await seedTtml(readMalformedTtml("control-char"))
			const plan = await planTtmlRepairs(db.env)
			await revertTtmlRepairs(db.env, await applyTtmlRepairs(db.env, plan))
			expect(await planTtmlRepairs(db.env)).toEqual(plan)
		})
	})
})
