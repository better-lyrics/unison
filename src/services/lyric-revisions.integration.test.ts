import type { JevCheckInput, JevGate } from "@/services/jev-gate"
import {
	type IntegrationDb,
	InterleavedDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import {
	AMAZING_GRACE_SPANISH,
	readRevisionFixture,
	shiftLrc,
	swapWords,
	withTranslation,
} from "@/test/lyric-fixtures"
import type { Env } from "@/types"
import { decompress } from "@/utils/compression"
import { sha256Hex } from "@/utils/hash"
import { shiftTtml } from "@/utils/ttml-timing"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	type RevisionInput,
	approveRevision,
	diffRevisions,
	listPendingCards,
	listRevisions,
	previewRevision,
	rejectRevision,
	revertToRevision,
	saveRevision,
	withdrawPending,
} from "./lyric-revisions"

const LRC = readRevisionFixture("amazing-grace.lrc")
const TTML = readRevisionFixture("amazing-grace.ttml")
const OWNER_KEY = "a".repeat(64)
const HOME_VIDEO = "HsBfV2A5dUY"

const lrc = (lyrics: string, extra: Partial<RevisionInput> = {}): RevisionInput => ({
	lyrics,
	format: "lrc",
	language: "en",
	...extra,
})

describeIntegration("lyric revisions pipeline (integration)", () => {
	let db: IntegrationDb
	let owner: number
	let lyricId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		owner = await seedUser(db, OWNER_KEY)
		lyricId = await seedLyric(db, owner, { lyrics: LRC, format: "lrc", videoId: HOME_VIDEO })
	})

	async function save(input: RevisionInput, env: Env = db.env) {
		const result = await saveRevision(env, lyricId, owner, input)
		if (!result.ok) throw new Error(`save failed: ${result.reason}`)
		return result.revision
	}

	async function statuses(): Promise<Array<{ rev_no: number; status: string }>> {
		const { rows } = await db.pool.query(
			"SELECT rev_no, status FROM lyric_revisions WHERE lyrics_id = $1 ORDER BY rev_no",
			[lyricId]
		)
		return rows
	}

	async function insertHistory(
		lyricsId: number,
		authorId: number,
		count: number,
		createdAt: number
	): Promise<void> {
		for (let i = 0; i < count; i++) {
			await db.pool.query(
				`INSERT INTO lyric_revisions (lyrics_id, rev_no, lyrics, format, sync_type, content_hash,
					author_id, status, created_at)
				 VALUES ($1, (SELECT MAX(rev_no) + 1 FROM lyric_revisions WHERE lyrics_id = $1),
					'x', 'lrc', 'linesync', 'x', $2, 'superseded', $3)`,
				[lyricsId, authorId, createdAt]
			)
		}
	}

	async function revisionId(revNo: number): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			"SELECT id FROM lyric_revisions WHERE lyrics_id = $1 AND rev_no = $2",
			[lyricId, revNo]
		)
		return rows[0].id
	}

	async function expectInvariants(): Promise<void> {
		const { rows: counts } = await db.pool.query(
			`SELECT count(*) FILTER (WHERE status = 'live')::int AS live,
				count(*) FILTER (WHERE status = 'pending')::int AS pending
			 FROM lyric_revisions WHERE lyrics_id = $1`,
			[lyricId]
		)
		expect(counts[0].live).toBe(1)
		expect(counts[0].pending).toBeLessThanOrEqual(1)
		const { rows } = await db.pool.query(
			`SELECT l.lyrics AS cached, l.format AS cached_format, l.sync_type AS cached_sync,
				l.language AS cached_language, l.isrc AS cached_isrc, r.*
			 FROM lyrics l JOIN lyric_revisions r ON r.id = l.current_revision_id
			 WHERE l.id = $1 AND r.status = 'live'`,
			[lyricId]
		)
		expect(rows).toHaveLength(1)
		const live = rows[0]
		expect(await decompress(live.cached)).toBe(await decompress(live.lyrics))
		expect(live.cached_format).toBe(live.format)
		expect(live.cached_sync).toBe(live.sync_type)
		expect(live.cached_language).toBe(live.language)
		expect(live.cached_isrc).toBe(live.isrc)
	}

	it("puts a small edit live and rewrites the lyric", async () => {
		const edited = swapWords(LRC, 2)
		const revision = await save(lrc(edited))

		expect(revision).toMatchObject({
			revNo: 2,
			status: "live",
			pendingReason: null,
			isAnchor: false,
			author: { displayName: expect.any(String) },
		})
		expect(revision.textDrift).toBeCloseTo(2 / 98, 5)
		const { rows } = await db.pool.query("SELECT lyrics FROM lyrics WHERE id = $1", [lyricId])
		expect(await decompress(rows[0].lyrics)).toBe(edited)
		expect(await statuses()).toEqual([
			{ rev_no: 1, status: "past" },
			{ rev_no: 2, status: "live" },
		])
		await expectInvariants()
	})

	it("clears the cache for every video the lyric serves when an edit goes live", async () => {
		await db.pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, $2)", [
			lyricId,
			"CDdvReNKKuk",
		])
		db.cache.store.set(`v:${HOME_VIDEO}`, "{}")
		db.cache.store.set("v:CDdvReNKKuk", "{}")

		await save(lrc(swapWords(LRC, 1)))

		expect(db.cache.store.has(`v:${HOME_VIDEO}`)).toBe(false)
		expect(db.cache.store.has("v:CDdvReNKKuk")).toBe(false)
	})

	it("keeps the cache when an edit only goes to review", async () => {
		db.cache.store.set(`v:${HOME_VIDEO}`, "{}")
		await save(lrc(swapWords(LRC, 15)))
		expect(db.cache.store.has(`v:${HOME_VIDEO}`)).toBe(true)
	})

	it("holds every edit to a sealed lyric for review", async () => {
		await db.pool.query(
			"UPDATE lyrics SET committee_approved_at = 1700000000, committee_approved_by = $2 WHERE id = $1",
			[lyricId, owner]
		)
		const revision = await save(lrc(swapWords(LRC, 1)))
		expect(revision).toMatchObject({ status: "pending", pendingReason: "sealed" })
		await expectInvariants()
	})

	describe("jev", () => {
		function recordingGate(
			verdict: () => Promise<{ flagged: boolean; probability: number | null }>
		) {
			const calls: JevCheckInput[] = []
			const gate: JevGate = {
				check: async (input) => {
					calls.push(input)
					return verdict()
				},
			}
			return { calls, env: { ...db.env, JEV: gate } }
		}

		it("holds an edit Jev flags and records the probability", async () => {
			const { env } = recordingGate(async () => ({ flagged: true, probability: 0.82 }))
			const revision = await save(lrc(swapWords(LRC, 1)), env)
			expect(revision).toMatchObject({ status: "pending", pendingReason: "flagged" })
			const { rows } = await db.pool.query(
				"SELECT jev_probability FROM lyric_revisions WHERE id = $1",
				[revision.id]
			)
			expect(rows[0].jev_probability).toBeCloseTo(0.82, 5)
			await expectInvariants()
		})

		it("puts an edit Jev does not flag live and records the probability", async () => {
			const { env } = recordingGate(async () => ({ flagged: false, probability: 0.12 }))
			const revision = await save(lrc(swapWords(LRC, 1)), env)
			expect(revision.status).toBe("live")
			const { rows } = await db.pool.query(
				"SELECT jev_probability FROM lyric_revisions WHERE id = $1",
				[revision.id]
			)
			expect(rows[0].jev_probability).toBeCloseTo(0.12, 5)
		})

		it("sends Jev the song, the artist, and the diff against the anchor", async () => {
			const { calls, env } = recordingGate(async () => ({ flagged: false, probability: 0.1 }))
			await save(lrc(swapWords(LRC, 1)), env)
			expect(calls).toHaveLength(1)
			expect(calls[0]).toMatchObject({
				lyricsId: lyricId,
				song: "Amazing Grace",
				artist: "Traditional",
			})
			expect(calls[0].diff).toContain("-[00:12.00] Amazing grace! How sweet the sound")
			expect(calls[0].diff).toContain("+[00:12.00] Amazing grace! How soft the sound")
		})

		describe("error paths", () => {
			it("puts the edit live when the Jev call fails", async () => {
				const { env } = recordingGate(async () => {
					throw new Error("TypeSafe returned 529")
				})
				expect((await save(lrc(swapWords(LRC, 1)), env)).status).toBe("live")
				await expectInvariants()
			})
		})

		describe("state changes between the unlocked and locked passes", () => {
			const seal = () =>
				db.pool.query(
					"UPDATE lyrics SET committee_approved_at = 1700000000, committee_approved_by = $2 WHERE id = $1",
					[lyricId, owner]
				)
			const unseal = () =>
				db.pool.query(
					"UPDATE lyrics SET committee_approved_at = NULL, committee_approved_by = NULL WHERE id = $1",
					[lyricId]
				)
			const once = (fn: () => Promise<unknown>) => {
				let done = false
				return async () => {
					if (done) return
					done = true
					await fn()
				}
			}

			it("regression: asks Jev before an edit goes live when the lyric is unsealed mid-save", async () => {
				await seal()
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.91 }))
				const interleaved = new InterleavedDb(db.pool, { before: once(unseal) })
				const revision = await save(lrc(swapWords(LRC, 1)), { ...env, DB: interleaved })
				expect(calls).toHaveLength(1)
				expect(revision).toMatchObject({ status: "pending", pendingReason: "flagged" })
				await expectInvariants()
			})

			it("regression: asks Jev before an edit goes live when an approve moves the anchor mid-save", async () => {
				const council = await seedCouncilMember(db, "c".repeat(64))
				const pending = await save(lrc(swapWords(LRC, 15)))
				const { calls, env } = recordingGate(async () => ({ flagged: false, probability: 0.1 }))
				const interleaved = new InterleavedDb(db.pool, {
					before: once(async () => {
						await approveRevision(db.env, lyricId, pending.id, council)
					}),
				})
				const revision = await save(lrc(swapWords(LRC, 16)), { ...env, DB: interleaved })
				expect(calls).toHaveLength(1)
				expect(revision).toMatchObject({ status: "live", textDrift: expect.closeTo(1 / 98, 5) })
				await expectInvariants()
			})

			it("gives up with stale when the state keeps changing under the save", async () => {
				await seal()
				const { calls, env } = recordingGate(async () => ({ flagged: false, probability: 0.1 }))
				const interleaved = new InterleavedDb(db.pool, { before: unseal, after: seal })
				expect(
					await saveRevision({ ...env, DB: interleaved }, lyricId, owner, lrc(swapWords(LRC, 1)))
				).toEqual({ ok: false, reason: "stale" })
				expect(interleaved.transactions).toBe(3)
				expect(calls).toHaveLength(0)
				expect(await statuses()).toEqual([{ rev_no: 1, status: "live" }])
			})

			it("trusts the unlocked pass when Jev is disabled", async () => {
				await seal()
				const interleaved = new InterleavedDb(db.pool, { before: once(unseal) })
				const revision = await save(lrc(swapWords(LRC, 1)), { ...db.env, DB: interleaved })
				expect(revision.status).toBe("live")
				expect(interleaved.transactions).toBe(1)
			})
		})

		describe("invariants", () => {
			it("never asks Jev about an edit that already goes to review for its drift", async () => {
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.99 }))
				const revision = await save(lrc(swapWords(LRC, 15)), env)
				expect(revision.pendingReason).toBe("large_text_drift")
				expect(calls).toHaveLength(0)
			})

			it("never asks Jev about an edit to a sealed lyric", async () => {
				await db.pool.query(
					"UPDATE lyrics SET committee_approved_at = 1700000000, committee_approved_by = $2 WHERE id = $1",
					[lyricId, owner]
				)
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.99 }))
				expect((await save(lrc(swapWords(LRC, 1)), env)).pendingReason).toBe("sealed")
				expect(calls).toHaveLength(0)
			})

			it("never asks Jev during a preview", async () => {
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.99 }))
				const result = await previewRevision(env, lyricId, owner, lrc(swapWords(LRC, 1)))
				expect(result).toMatchObject({ ok: true, preview: { outcome: { goesLive: true } } })
				expect(calls).toHaveLength(0)
			})

			it("never asks Jev about an edit whose lyrics match the anchor", async () => {
				await save(lrc(swapWords(LRC, 2)))
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.99 }))
				expect((await save(lrc(LRC, { language: "es" }), env)).status).toBe("live")
				const reverted = await revertToRevision(env, lyricId, owner, await revisionId(1))
				expect(reverted).toMatchObject({ ok: true, revision: { status: "live" } })
				expect(calls).toHaveLength(0)
			})

			it("never asks Jev about a save that changes nothing", async () => {
				const { calls, env } = recordingGate(async () => ({ flagged: true, probability: 0.99 }))
				expect(await saveRevision(env, lyricId, owner, lrc(LRC))).toEqual({
					ok: false,
					reason: "no_changes",
				})
				expect(calls).toHaveLength(0)
			})
		})
	})

	describe("ttml head text", () => {
		const SPANISH_TTML = withTranslation(TTML, "es", AMAZING_GRACE_SPANISH)
		const retranslated = (edit: (line: string, index: number) => string) =>
			withTranslation(TTML, "es", AMAZING_GRACE_SPANISH.map(edit))
		let ttmlLyric: number

		beforeEach(async () => {
			ttmlLyric = await seedLyric(db, owner, {
				lyrics: SPANISH_TTML,
				format: "ttml",
				videoId: "ttmlspanish",
			})
		})

		function recordingGate(flagged: boolean) {
			const calls: JevCheckInput[] = []
			const gate: JevGate = {
				check: async (input) => {
					calls.push(input)
					return { flagged, probability: flagged ? 0.9 : 0.1 }
				},
			}
			return { calls, env: { ...db.env, JEV: gate } }
		}

		const saveTtml = async (lyrics: string, env: Env = db.env) => {
			const result = await saveRevision(env, ttmlLyric, owner, { lyrics, format: "ttml" })
			if (!result.ok) throw new Error(`save failed: ${result.reason}`)
			return result.revision
		}

		it("measures a head-only translation change as text drift and asks Jev about it", async () => {
			const { calls, env } = recordingGate(false)
			const revision = await saveTtml(
				retranslated((line, index) => (index === 1 ? "Que salvó a un alma como yo" : line)),
				env
			)
			expect(revision.status).toBe("live")
			expect(revision.textDrift).toBeGreaterThan(0)
			expect(revision.timingDrift).toBe(0)
			expect(calls).toHaveLength(1)
			expect(calls[0].diff).toContain("-[translation es L2] Que salvó a un desdichado como yo")
			expect(calls[0].diff).toContain("+[translation es L2] Que salvó a un alma como yo")
		})

		it("holds a head-only translation change Jev flags", async () => {
			const { env } = recordingGate(true)
			const revision = await saveTtml(
				retranslated((line, index) => (index === 1 ? "Visita mi-tienda.example" : line)),
				env
			)
			expect(revision).toMatchObject({ status: "pending", pendingReason: "flagged" })
		})

		it("holds a large head replacement for its text drift", async () => {
			const revision = await saveTtml(retranslated((_, index) => `Línea traducida ${index}`))
			expect(revision).toMatchObject({ status: "pending", pendingReason: "large_text_drift" })
			expect(revision.textDrift).toBeGreaterThan(0.15)
		})

		it("shows head changes in the council card diff", async () => {
			const pending = await saveTtml(retranslated((_, index) => `Línea traducida ${index}`))
			const card = (await listPendingCards(db.env)).find((c) => c.revisionId === pending.id)
			expect(card?.diffFull).toContain("-[translation es L1] ¡Sublime gracia! Qué dulce el sonido")
			expect(card?.diffFull).toContain("+[translation es L1] Línea traducida 0")
			expect(card?.diffPreview).toContain("[translation es L1]")
		})

		describe("edge cases", () => {
			it("counts a whitespace-only head change as 0 drift and skips Jev", async () => {
				const { calls, env } = recordingGate(true)
				const revision = await saveTtml(
					retranslated((line) => `  ${line}\n`),
					env
				)
				expect(revision).toMatchObject({ status: "live", textDrift: 0, timingDrift: 0 })
				expect(calls).toHaveLength(0)
			})
		})
	})

	it("holds a large text change", async () => {
		const revision = await save(lrc(swapWords(LRC, 15)))
		expect(revision).toMatchObject({ status: "pending", pendingReason: "large_text_drift" })
		expect(revision.textDrift).toBeGreaterThan(0.15)
		await expectInvariants()
	})

	it("holds a non-uniform retime of more than 30% of the lines", async () => {
		const moved = new Set([1, 4, 7, 10, 13])
		const revision = await save(lrc(shiftLrc(LRC, (i) => (moved.has(i) ? 2500 : 0))))
		expect(revision).toMatchObject({ status: "pending", pendingReason: "large_timing_drift" })
		expect(revision.timingDrift).toBeCloseTo(5 / 16, 5)
	})

	it("puts a whole-lyric offset live", async () => {
		const revision = await save(lrc(shiftLrc(LRC, () => 1500)))
		expect(revision).toMatchObject({ status: "live", timingDrift: 0, textDrift: 0 })
	})

	it("puts a language and ISRC change live and normalizes the ISRC", async () => {
		const revision = await save(lrc(LRC, { language: "es", isrc: "us-rc1-76-07839" }))
		expect(revision.status).toBe("live")
		const { rows } = await db.pool.query("SELECT language, isrc FROM lyrics WHERE id = $1", [
			lyricId,
		])
		expect(rows[0]).toEqual({ language: "es", isrc: "USRC17607839" })
	})

	it("refuses a save that changes nothing", async () => {
		expect(await saveRevision(db.env, lyricId, owner, lrc(LRC))).toEqual({
			ok: false,
			reason: "no_changes",
		})
	})

	describe("language and isrc in the body", () => {
		const liveMetadata = async () =>
			(await db.pool.query("SELECT language, isrc FROM lyrics WHERE id = $1", [lyricId])).rows[0]

		it("keeps the current language and ISRC when the body leaves them out", async () => {
			await save(lrc(LRC, { isrc: "USRC17607839" }))
			const kept = await save({ lyrics: swapWords(LRC, 1), format: "lrc" })
			expect(kept.status).toBe("live")
			expect(await liveMetadata()).toEqual({ language: "en", isrc: "USRC17607839" })
			await expectInvariants()
		})

		it("clears a field sent as null", async () => {
			await save(lrc(LRC, { isrc: "USRC17607839" }))
			await save({ lyrics: LRC, format: "lrc", language: null, isrc: null })
			expect(await liveMetadata()).toEqual({ language: null, isrc: null })
			await expectInvariants()
		})

		it("clears a field sent as an empty string", async () => {
			await save(lrc(LRC, { isrc: "USRC17607839" }))
			await save({ lyrics: LRC, format: "lrc", language: "", isrc: "" })
			expect(await liveMetadata()).toEqual({ language: null, isrc: null })
		})

		it("sets a field sent with a value", async () => {
			await save({ lyrics: LRC, format: "lrc", isrc: "GBAYE0400001" })
			expect(await liveMetadata()).toEqual({ language: "en", isrc: "GBAYE0400001" })
		})

		describe("no-op check", () => {
			it("is a no-op when the body leaves both fields out and the lyrics match", async () => {
				expect(await saveRevision(db.env, lyricId, owner, { lyrics: LRC, format: "lrc" })).toEqual({
					ok: false,
					reason: "no_changes",
				})
			})

			it("is a no-op when the body sends the current values back unchanged", async () => {
				await save(lrc(LRC, { isrc: "USRC17607839" }))
				expect(
					await saveRevision(db.env, lyricId, owner, lrc(LRC, { isrc: "USRC17607839" }))
				).toEqual({ ok: false, reason: "no_changes" })
			})

			it("is a no-op when the current ISRC comes back in another spelling", async () => {
				await save(lrc(LRC, { isrc: "USRC17607839" }))
				expect(
					await saveRevision(db.env, lyricId, owner, lrc(LRC, { isrc: "us-rc1-76-07839" }))
				).toEqual({ ok: false, reason: "no_changes" })
			})
		})
	})

	describe("edge cases", () => {
		it("counts clearing a set language as a change, not a no-op", async () => {
			const result = await saveRevision(db.env, lyricId, owner, lrc(LRC, { language: "" }))
			expect(result).toMatchObject({ ok: true, revision: { status: "live" } })
		})

		it("counts clearing a set ISRC as a change, and an empty ISRC as no ISRC", async () => {
			await save(lrc(LRC, { isrc: "USRC17607839" }))
			expect(await saveRevision(db.env, lyricId, owner, lrc(LRC, { isrc: "  " }))).toMatchObject({
				ok: true,
			})
			expect(await saveRevision(db.env, lyricId, owner, lrc(LRC, { isrc: null }))).toEqual({
				ok: false,
				reason: "no_changes",
			})
		})

		it("accepts a legacy language outside the list only while it stays unchanged", async () => {
			await db.pool.query("UPDATE lyric_revisions SET language = 'ca' WHERE lyrics_id = $1", [
				lyricId,
			])
			expect(
				await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1), { language: "ca" }))
			).toMatchObject({ ok: true })
			expect(
				await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 2), { language: "gd" }))
			).toMatchObject({ ok: false, reason: "invalid", code: "INVALID_PAYLOAD" })
		})
	})

	it("refuses anyone but the owner", async () => {
		const stranger = await seedUser(db, "b".repeat(64))
		expect(await saveRevision(db.env, lyricId, stranger, lrc(swapWords(LRC, 1)))).toEqual({
			ok: false,
			reason: "not_owner",
		})
	})

	it("returns not found for a deleted or missing lyric", async () => {
		await db.pool.query(
			"UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
			[lyricId, owner]
		)
		expect((await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1)))).ok).toBe(false)
		expect(await saveRevision(db.env, 999_999, owner, lrc(swapWords(LRC, 1)))).toEqual({
			ok: false,
			reason: "not_found",
		})
	})

	it("rejects invalid content, language, and ISRC with the matching code", async () => {
		const brokenTtml = await saveRevision(db.env, lyricId, owner, {
			lyrics: "<tt><body><div><p>unclosed",
			format: "ttml",
		})
		expect(brokenTtml).toMatchObject({ ok: false, reason: "invalid", code: "TTML_MALFORMED" })
		expect(
			await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1), { language: "klingon" }))
		).toMatchObject({ ok: false, reason: "invalid", code: "INVALID_PAYLOAD" })
		expect(
			await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1), { isrc: "not-an-isrc" }))
		).toMatchObject({ ok: false, reason: "invalid", code: "INVALID_PAYLOAD" })
		expect(await statuses()).toEqual([{ rev_no: 1, status: "live" }])
	})

	describe("rate limits", () => {
		const now = () => Math.floor(Date.now() / 1000)

		it("allows five revisions per lyric in 24 hours", async () => {
			await insertHistory(lyricId, owner, 5, now())
			expect(await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1)))).toEqual({
				ok: false,
				reason: "rate_limited",
			})
		})

		it("allows twenty revisions per user across lyrics in 24 hours", async () => {
			for (let i = 0; i < 4; i++) {
				const other = await seedLyric(db, owner, {
					lyrics: LRC,
					format: "lrc",
					videoId: `other${i}`,
				})
				await insertHistory(other, owner, 5, now())
			}
			expect(await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1)))).toEqual({
				ok: false,
				reason: "rate_limited",
			})
		})

		it("regression: concurrent saves on several lyrics stop at exactly twenty for the user", async () => {
			const history = await seedLyric(db, owner, { lyrics: LRC, format: "lrc", videoId: "history" })
			await insertHistory(history, owner, 5, now())
			for (let i = 0; i < 3; i++) {
				const other = await seedLyric(db, owner, {
					lyrics: LRC,
					format: "lrc",
					videoId: `full${i}`,
				})
				await insertHistory(other, owner, i < 2 ? 5 : 4, now())
			}
			const targets = [lyricId]
			for (let i = 0; i < 4; i++) {
				targets.push(
					await seedLyric(db, owner, { lyrics: LRC, format: "lrc", videoId: `race${i}` })
				)
			}
			const results = await Promise.all(
				targets.map((id) => saveRevision(db.env, id, owner, lrc(swapWords(LRC, 1))))
			)
			expect(results.filter((r) => r.ok)).toHaveLength(1)
			expect(results.filter((r) => !r.ok && r.reason === "rate_limited")).toHaveLength(4)
			const { rows } = await db.pool.query(
				"SELECT count(*)::int AS n FROM lyric_revisions WHERE author_id = $1 AND rev_no > 1",
				[owner]
			)
			expect(rows[0].n).toBe(20)
		})

		it("counts a rolling window, so older revisions free up the slot", async () => {
			await insertHistory(lyricId, owner, 5, now() - 24 * 60 * 60 - 1)
			expect((await saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1)))).ok).toBe(true)
		})

		it("reports the remaining edits in the preview", async () => {
			await insertHistory(lyricId, owner, 2, now())
			const result = await previewRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1)))
			if (!result.ok) throw new Error(result.reason)
			expect(result.preview.rateLimit).toEqual({
				lyricRemaining: 3,
				lyricLimit: 5,
				userRemaining: 18,
				userLimit: 20,
			})
		})
	})

	describe("one pending slot", () => {
		it("supersedes the pending revision when a new one goes to review", async () => {
			await save(lrc(swapWords(LRC, 15)))
			await save(lrc(swapWords(LRC, 16)))
			expect(await statuses()).toEqual([
				{ rev_no: 1, status: "live" },
				{ rev_no: 2, status: "superseded" },
				{ rev_no: 3, status: "pending" },
			])
		})

		it("supersedes the pending revision when a new edit goes live", async () => {
			await save(lrc(swapWords(LRC, 15)))
			await save(lrc(swapWords(LRC, 1)))
			expect(await statuses()).toEqual([
				{ rev_no: 1, status: "past" },
				{ rev_no: 2, status: "superseded" },
				{ rev_no: 3, status: "live" },
			])
			await expectInvariants()
		})
	})

	describe("revert", () => {
		it("reverts to the anchor with zero drift and goes live", async () => {
			await save(lrc(swapWords(LRC, 10)))
			const reverted = await revertToRevision(db.env, lyricId, owner, await revisionId(1))
			if (!reverted.ok) throw new Error(reverted.reason)
			expect(reverted.revision).toMatchObject({
				revNo: 3,
				status: "live",
				revertsRevNo: 1,
				textDrift: 0,
				timingDrift: 0,
			})
			const { rows } = await db.pool.query("SELECT lyrics FROM lyrics WHERE id = $1", [lyricId])
			expect(await decompress(rows[0].lyrics)).toBe(LRC)
			await expectInvariants()
		})

		it("refuses to revert to the live revision", async () => {
			expect(await revertToRevision(db.env, lyricId, owner, await revisionId(1))).toEqual({
				ok: false,
				reason: "no_changes",
			})
		})

		it("only reverts to a revision that was live", async () => {
			const pending = await save(lrc(swapWords(LRC, 15)))
			expect(await revertToRevision(db.env, lyricId, owner, pending.id)).toEqual({
				ok: false,
				reason: "not_found",
			})
		})

		it("sends a revert on a sealed lyric to review", async () => {
			await save(lrc(swapWords(LRC, 3)))
			await db.pool.query(
				"UPDATE lyrics SET committee_approved_at = 1700000000, committee_approved_by = $2 WHERE id = $1",
				[lyricId, owner]
			)
			const reverted = await revertToRevision(db.env, lyricId, owner, await revisionId(1))
			expect(reverted).toMatchObject({
				ok: true,
				revision: { status: "pending", pendingReason: "sealed" },
			})
		})
	})

	describe("withdraw", () => {
		it("withdraws the pending revision", async () => {
			await save(lrc(swapWords(LRC, 15)))
			const result = await withdrawPending(db.env, lyricId, owner)
			expect(result).toMatchObject({ ok: true, revision: { revNo: 2, status: "withdrawn" } })
			await expectInvariants()
		})

		it("returns not found when nothing is pending", async () => {
			expect(await withdrawPending(db.env, lyricId, owner)).toEqual({
				ok: false,
				reason: "not_found",
			})
		})

		it("refuses anyone but the owner", async () => {
			await save(lrc(swapWords(LRC, 15)))
			const stranger = await seedUser(db, "b".repeat(64))
			expect(await withdrawPending(db.env, lyricId, stranger)).toEqual({
				ok: false,
				reason: "not_owner",
			})
		})
	})

	describe("council decisions", () => {
		it("approves a pending revision, makes it live, and moves the anchor", async () => {
			const council = await seedCouncilMember(db, "c".repeat(64))
			const pending = await save(lrc(swapWords(LRC, 15)))
			const approved = await approveRevision(db.env, lyricId, pending.id, council)
			expect(approved).toMatchObject({
				ok: true,
				revision: { status: "live", isAnchor: true, reviewedAt: expect.any(Number) },
			})
			await expectInvariants()

			const next = await save(lrc(swapWords(LRC, 16)))
			expect(next.status).toBe("live")
			expect(next.textDrift).toBeCloseTo(1 / 98, 5)
		})

		it("rejects with a note and shows it on the history", async () => {
			const council = await seedCouncilMember(db, "c".repeat(64))
			const pending = await save(lrc(swapWords(LRC, 15)))
			const rejected = await rejectRevision(
				db.env,
				lyricId,
				pending.id,
				council,
				"Keep the hymn text"
			)
			expect(rejected).toMatchObject({
				ok: true,
				revision: { status: "rejected", reviewNote: "Keep the hymn text" },
			})
			await expectInvariants()
		})

		it("refuses a reviewer outside the council", async () => {
			const pending = await save(lrc(swapWords(LRC, 15)))
			expect(await approveRevision(db.env, lyricId, pending.id, owner)).toEqual({
				ok: false,
				reason: "not_committee",
			})
		})

		describe("regressions", () => {
			it("regression: a second decision on the same revision is ALREADY_DECIDED", async () => {
				const council = await seedCouncilMember(db, "c".repeat(64))
				const pending = await save(lrc(swapWords(LRC, 15)))
				await approveRevision(db.env, lyricId, pending.id, council)
				expect(await approveRevision(db.env, lyricId, pending.id, council)).toEqual({
					ok: false,
					reason: "already_decided",
				})
				expect(await rejectRevision(db.env, lyricId, pending.id, council, null)).toEqual({
					ok: false,
					reason: "already_decided",
				})
			})

			it("regression: a decision on a superseded or withdrawn revision is STALE", async () => {
				const council = await seedCouncilMember(db, "c".repeat(64))
				const first = await save(lrc(swapWords(LRC, 15)))
				await save(lrc(swapWords(LRC, 16)))
				expect(await approveRevision(db.env, lyricId, first.id, council)).toEqual({
					ok: false,
					reason: "stale",
				})
				await withdrawPending(db.env, lyricId, owner)
				const { rows } = await db.pool.query(
					"SELECT id FROM lyric_revisions WHERE lyrics_id = $1 AND status = 'withdrawn'",
					[lyricId]
				)
				expect(await rejectRevision(db.env, lyricId, rows[0].id, council, null)).toEqual({
					ok: false,
					reason: "stale",
				})
			})

			it("regression: two council members deciding at once produce exactly one decision", async () => {
				const a = await seedCouncilMember(db, "c".repeat(64))
				const b = await seedCouncilMember(db, "d".repeat(64))
				const pending = await save(lrc(swapWords(LRC, 15)))
				const results = await Promise.all([
					approveRevision(db.env, lyricId, pending.id, a),
					rejectRevision(db.env, lyricId, pending.id, b, null),
				])
				expect(results.filter((r) => r.ok)).toHaveLength(1)
				expect(results.filter((r) => !r.ok && r.reason === "already_decided")).toHaveLength(1)
				await expectInvariants()
			})
		})
	})

	describe("regressions", () => {
		it("regression: salami slicing ends in review because every slice is measured against the anchor", async () => {
			expect((await save(lrc(swapWords(LRC, 5)))).status).toBe("live")
			expect((await save(lrc(swapWords(LRC, 10)))).status).toBe("live")
			const third = await save(lrc(swapWords(LRC, 15)))
			expect(third).toMatchObject({ status: "pending", pendingReason: "large_text_drift" })
		})

		it("regression: sitting just under the limit leaves no room for the next edit", async () => {
			expect((await save(lrc(swapWords(LRC, 14)))).status).toBe("live")
			expect((await save(lrc(swapWords(LRC, 15)))).status).toBe("pending")
		})

		it("regression: A to B to A goes live with zero drift", async () => {
			await save(lrc(swapWords(LRC, 10)))
			const back = await save(lrc(LRC))
			expect(back).toMatchObject({ status: "live", textDrift: 0 })
		})

		it("regression: a uniform offset on TTML counts as zero timing drift", async () => {
			const ttmlOwner = await seedUser(db, "e".repeat(64))
			const ttmlLyric = await seedLyric(db, ttmlOwner, {
				lyrics: TTML,
				format: "ttml",
				videoId: "ttmlvideo01",
			})
			const result = await saveRevision(db.env, ttmlLyric, ttmlOwner, {
				lyrics: shiftTtml(TTML, 2),
				format: "ttml",
			})
			expect(result).toMatchObject({ ok: true, revision: { status: "live", timingDrift: 0 } })
		})
	})

	describe("invariants", () => {
		it("serializes concurrent saves into consecutive revisions with one live", async () => {
			const results = await Promise.all([
				saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1))),
				saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 2))),
			])
			expect(results.every((r) => r.ok)).toBe(true)
			expect(await statuses()).toEqual([
				{ rev_no: 1, status: "past" },
				{ rev_no: 2, status: "past" },
				{ rev_no: 3, status: "live" },
			])
			await expectInvariants()
		})

		it("lets only one of two concurrent saves take the last daily slot", async () => {
			await insertHistory(lyricId, owner, 4, Math.floor(Date.now() / 1000))
			const results = await Promise.all([
				saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 1))),
				saveRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 2))),
			])
			expect(results.filter((r) => r.ok)).toHaveLength(1)
			expect(results.filter((r) => !r.ok && r.reason === "rate_limited")).toHaveLength(1)
		})

		it("never changes votes or scores", async () => {
			const voter = await seedUser(db, "f".repeat(64))
			const council = await seedCouncilMember(db, "c".repeat(64))
			await db.pool.query(
				"INSERT INTO votes (lyrics_id, user_id, vote) VALUES ($1, $2, 1), ($1, $3, -1)",
				[lyricId, voter, council]
			)
			await db.pool.query(
				`UPDATE lyrics SET score = 3, upvotes = 4, downvotes = 1, effective_score = 2.5,
					vote_count = 5, confidence = 'medium' WHERE id = $1`,
				[lyricId]
			)
			const snapshot = async () =>
				(
					await db.pool.query(
						`SELECT score, upvotes, downvotes, effective_score, vote_count, confidence,
							(SELECT count(*)::int FROM votes WHERE lyrics_id = $1) AS votes
						 FROM lyrics WHERE id = $1`,
						[lyricId]
					)
				).rows[0]
			const before = await snapshot()

			await save(lrc(swapWords(LRC, 2)))
			const pending = await save(lrc(swapWords(LRC, 15)))
			await approveRevision(db.env, lyricId, pending.id, council)
			await revertToRevision(db.env, lyricId, owner, await revisionId(1))

			expect(await snapshot()).toEqual(before)
		})

		it("preview predicts exactly what save does", async () => {
			const moved = new Set([1, 4, 7, 10, 13])
			const inputs = [
				lrc(swapWords(LRC, 3)),
				lrc(swapWords(LRC, 15)),
				lrc(shiftLrc(LRC, (i) => (moved.has(i) ? 2500 : 0))),
				lrc(
					shiftLrc(LRC, () => -800),
					{ language: "es" }
				),
			]
			for (const [index, input] of inputs.entries()) {
				const id = await seedLyric(db, owner, {
					lyrics: LRC,
					format: "lrc",
					videoId: `preview${index}`,
				})
				const preview = await previewRevision(db.env, id, owner, input)
				const saved = await saveRevision(db.env, id, owner, input)
				if (!preview.ok || !saved.ok) throw new Error("preview or save failed")
				expect(saved.revision.status).toBe(preview.preview.outcome.goesLive ? "live" : "pending")
				expect(saved.revision.pendingReason).toBe(preview.preview.outcome.reason)
				expect(saved.revision.textDrift).toBeCloseTo(preview.preview.drift.text, 10)
				expect(saved.revision.timingDrift).toBeCloseTo(preview.preview.drift.timing, 10)
			}
		})

		it("preview saves nothing", async () => {
			await previewRevision(db.env, lyricId, owner, lrc(swapWords(LRC, 15)))
			expect(await statuses()).toEqual([{ rev_no: 1, status: "live" }])
		})
	})

	describe("history, diff, and the council queue", () => {
		it("lists revisions newest first with the anchor marked", async () => {
			await save(lrc(swapWords(LRC, 1)))
			const revisions = await listRevisions(db.env, lyricId)
			expect(revisions?.map((r) => [r.revNo, r.status, r.isAnchor])).toEqual([
				[2, "live", false],
				[1, "past", true],
			])
		})

		it("diffs a revision against the previously live one by default", async () => {
			const revision = await save(lrc(swapWords(LRC, 1)))
			const diff = await diffRevisions(db.env, lyricId, revision.id, null)
			expect(diff?.againstRevNo).toBe(1)
			expect(diff?.rows.find((row) => row.kind === "word")).toMatchObject({
				kind: "word",
				lineNo: 1,
			})
		})

		it("diffs a pending revision against the live one, skipping superseded saves", async () => {
			await save(lrc(swapWords(LRC, 15)))
			const latest = await save(lrc(swapWords(LRC, 16)))
			expect((await diffRevisions(db.env, lyricId, latest.id, null))?.againstRevNo).toBe(1)
		})

		it("diffs against an explicit revision", async () => {
			await save(lrc(swapWords(LRC, 1)))
			const third = await save(lrc(swapWords(LRC, 2)))
			const diff = await diffRevisions(db.env, lyricId, third.id, await revisionId(1))
			expect(diff?.againstRevNo).toBe(1)
			expect(diff?.rows.filter((row) => row.kind === "word")).toHaveLength(2)
		})

		describe("edge cases", () => {
			it("returns no rows and no comparison for rev 1", async () => {
				expect(await diffRevisions(db.env, lyricId, await revisionId(1), null)).toEqual({
					rows: [],
					againstRevNo: null,
				})
			})

			it("returns null for an explicit revision from another lyric", async () => {
				expect(await diffRevisions(db.env, lyricId, await revisionId(1), 999_999)).toBeNull()
			})
		})

		it("builds a queue card with a unified diff against the live revision", async () => {
			const pending = await save(lrc(swapWords(LRC, 15)))
			const [card] = await listPendingCards(db.env)
			expect(card).toMatchObject({
				lyricsId: lyricId,
				revisionId: pending.id,
				revNo: 2,
				liveRevNo: 1,
				videoId: HOME_VIDEO,
				song: "Amazing Grace",
				artist: "Traditional",
				format: "lrc",
				pendingReason: "large_text_drift",
				jevProbability: null,
			})
			expect(card.diffFull).toContain("--- rev 1")
			expect(card.diffPreview.split("\n")).toHaveLength(6)
			expect(card.diffPreview).toContain("-[00:12.00] Amazing grace! How sweet the sound")
		})

		it("leaves deleted lyrics out of the queue", async () => {
			await save(lrc(swapWords(LRC, 15)))
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
				[lyricId, owner]
			)
			expect(await listPendingCards(db.env)).toEqual([])
		})

		it("stores the content hash of what was saved", async () => {
			const edited = swapWords(LRC, 1)
			const revision = await save(lrc(edited))
			const { rows } = await db.pool.query(
				"SELECT content_hash FROM lyric_revisions WHERE id = $1",
				[revision.id]
			)
			expect(rows[0].content_hash).toBe(sha256Hex(edited))
		})
	})
})
