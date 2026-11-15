import { config } from "@/config"
import { AVATAR_PRESETS } from "@/db/avatar-presets"
import { lyricsRoutes } from "@/routes/lyrics"
import { reviewQueueBotRoutes } from "@/routes/review-queue"
import { videoLinkRoutes } from "@/routes/video-links"
import {
	BOT_SECRET,
	type IntegrationDb,
	InterleavedDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import {
	AMAZING_GRACE_SPANISH,
	readRevisionFixture,
	swapWords,
	withTranslation,
} from "@/test/lyric-fixtures"
import type {
	Env,
	LyricsResponse,
	PendingRevisionCard,
	PreviewResult,
	RevisionBar,
	RevisionDetail,
	RevisionDiff,
	RevisionSummary,
} from "@/types"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { revisionBotRoutes, revisionRoutes } from "./revisions"

const LRC = readRevisionFixture("amazing-grace.lrc")
const OWNER_KEY = "a".repeat(64)
const COUNCIL_KEY = "c".repeat(64)

interface Envelope<T> {
	success: boolean
	data: T
	code?: string
	hint?: string
}

type Saved = { revision: RevisionSummary }

const buildApp = (env: Env) =>
	new Elysia()
		.use(lyricsRoutes(env))
		.use(videoLinkRoutes(env))
		.use(revisionRoutes(env))
		.use(reviewQueueBotRoutes(env))
		.use(revisionBotRoutes(env))

describeIntegration("revision routes (integration)", () => {
	let db: IntegrationDb
	let lyricId: number
	let owner: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		owner = await seedUser(db, OWNER_KEY)
		lyricId = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
		seedSession(db, "owner-token", OWNER_KEY)
	})

	const call = async <T = unknown>(
		method: string,
		path: string,
		opts: { token?: string; body?: unknown; env?: Env; headers?: Record<string, string> } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers }
		if (opts.token) headers.authorization = `Bearer ${opts.token}`
		const res = await buildApp(opts.env ?? db.env).handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			})
		)
		return { status: res.status, json: (await res.json()) as Envelope<T> }
	}

	const saveAsOwner = (lyrics: string) =>
		call<Saved>("POST", `/lyrics/${lyricId}/revisions`, {
			token: "owner-token",
			body: { lyrics, format: "lrc", language: "en" },
		})
	const listRevisions = () =>
		call<{ revisions: RevisionSummary[] }>("GET", `/lyrics/${lyricId}/revisions`)
	const lyricDetail = () =>
		call<LyricsResponse & { revision: RevisionBar }>("GET", `/lyrics/${lyricId}`)

	describe("happy paths", () => {
		it("saves a revision for the owner and returns its summary", async () => {
			const { status, json } = await saveAsOwner(swapWords(LRC, 1))
			expect(status).toBe(200)
			expect(json).toMatchObject({
				success: true,
				data: { revision: { revNo: 2, status: "live", pendingReason: null } },
			})
		})

		it("previews without saving", async () => {
			const { status, json } = await call<PreviewResult>(
				"POST",
				`/lyrics/${lyricId}/revisions/preview`,
				{
					token: "owner-token",
					body: { lyrics: swapWords(LRC, 15), format: "lrc", language: "en" },
				}
			)
			expect(status).toBe(200)
			expect(json.data).toMatchObject({
				outcome: { goesLive: false, reason: "large_text_drift" },
				noChanges: false,
				drift: { textLimit: 0.15, timingLimit: 0.3, anchorRevNo: 1 },
				rateLimit: { lyricRemaining: 5, userRemaining: 20 },
			})
			expect(json.data.checks.map((c) => c.field)).toEqual(["lyrics", "language", "isrc", "album"])
			expect((await listRevisions()).json.data.revisions).toHaveLength(1)
		})

		it("returns the preview diff against the live revision with field rows last", async () => {
			const { status, json } = await call<PreviewResult>(
				"POST",
				`/lyrics/${lyricId}/revisions/preview`,
				{
					token: "owner-token",
					body: {
						lyrics: swapWords(LRC, 1),
						format: "lrc",
						language: "es",
						isrc: "USRC17607839",
						album: "Sacred Songs",
					},
				}
			)
			expect(status).toBe(200)
			expect(json.data.noChanges).toBe(false)
			expect(json.data.diff).toEqual({
				rows: [
					{
						kind: "word",
						lineNo: 1,
						startMs: 12000,
						parts: [
							["=", "Amazing grace! How "],
							["-", "sweet"],
							["+", "soft"],
							["=", " the sound"],
						],
					},
					{ kind: "same", lineNo: 2, startMs: 16000, text: "That saved a wretch like me!" },
					{ kind: "same", lineNo: 3, startMs: 20000, text: "I once was lost, but now am found;" },
					{ kind: "gap", count: 13 },
					{ kind: "field", field: "language", before: "en", after: "es" },
					{ kind: "field", field: "isrc", before: null, after: "USRC17607839" },
					{ kind: "field", field: "album", before: null, after: "Sacred Songs" },
				],
				againstRevNo: 1,
			})
		})

		it("returns an empty preview diff when nothing changed", async () => {
			const { json } = await call<PreviewResult>("POST", `/lyrics/${lyricId}/revisions/preview`, {
				token: "owner-token",
				body: { lyrics: LRC, format: "lrc", language: "en" },
			})
			expect(json.data.noChanges).toBe(true)
			expect(json.data.diff).toEqual({ rows: [], againstRevNo: 1 })
		})

		it("returns only field rows in the preview diff when the lyrics do not parse", async () => {
			const { status, json } = await call<PreviewResult>(
				"POST",
				`/lyrics/${lyricId}/revisions/preview`,
				{
					token: "owner-token",
					body: { lyrics: "<tt><body><div><p>unclosed", format: "ttml", language: "es" },
				}
			)
			expect(status).toBe(200)
			expect(json.data.diff).toEqual({
				rows: [{ kind: "field", field: "language", before: "en", after: "es" }],
				againstRevNo: 1,
			})
		})

		it("returns history diff field rows with the same shape as the preview", async () => {
			await call<Saved>("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: LRC, format: "lrc", language: "es" },
			})
			const [latest] = (await listRevisions()).json.data.revisions
			const diff = await call<RevisionDiff>("GET", `/lyrics/${lyricId}/revisions/${latest.id}/diff`)
			expect(diff.json.data.rows.at(-1)).toEqual({
				kind: "field",
				field: "language",
				before: "en",
				after: "es",
			})
		})

		it("lists, reads, and diffs revisions without auth", async () => {
			await saveAsOwner(swapWords(LRC, 1))
			const list = await listRevisions()
			expect(list.status).toBe(200)
			const [latest] = list.json.data.revisions
			const detail = await call<RevisionDetail>("GET", `/lyrics/${lyricId}/revisions/${latest.id}`)
			expect(detail.json.data).toMatchObject({
				revNo: 2,
				format: "lrc",
				language: "en",
				album: null,
			})
			expect(detail.json.data.lyrics).toBe(swapWords(LRC, 1))
			const diff = await call<RevisionDiff>("GET", `/lyrics/${lyricId}/revisions/${latest.id}/diff`)
			expect(diff.json.data.againstRevNo).toBe(1)
			expect(diff.json.data.rows[0]).toMatchObject({ kind: "word", lineNo: 1 })
		})

		it("returns head rows after the body rows for a head-only translation edit", async () => {
			const ttml = withTranslation(
				readRevisionFixture("amazing-grace.ttml"),
				"es",
				AMAZING_GRACE_SPANISH
			)
			const ttmlLyric = await seedLyric(db, owner, {
				lyrics: ttml,
				format: "ttml",
				videoId: "ttmlspanish",
			})
			const edited = ttml.replace("Que salvó a un desdichado", "Que salvó a un alma")
			const saved = await call<Saved>("POST", `/lyrics/${ttmlLyric}/revisions`, {
				token: "owner-token",
				body: { lyrics: edited, format: "ttml" },
			})
			expect(saved.status).toBe(200)
			const diff = await call<RevisionDiff>(
				"GET",
				`/lyrics/${ttmlLyric}/revisions/${saved.json.data.revision.id}/diff`
			)
			expect(diff.status).toBe(200)
			const { rows } = diff.json.data
			expect(rows[0]).toEqual({ kind: "gap", count: 16 })
			expect(rows.find((row) => row.kind === "word")).toMatchObject({
				lineNo: 3,
				startMs: null,
				head: { kind: "translation", lang: "es", line: 2 },
			})
		})

		it("reverts and withdraws through the owner routes", async () => {
			const rev1 = (await listRevisions()).json.data.revisions[0].id
			await saveAsOwner(swapWords(LRC, 2))
			const revert = await call<Saved>("POST", `/lyrics/${lyricId}/revisions/${rev1}/revert`, {
				token: "owner-token",
				body: {},
			})
			expect(revert.json.data.revision).toMatchObject({ revNo: 3, revertsRevNo: 1, status: "live" })

			await saveAsOwner(swapWords(LRC, 15))
			const withdraw = await call<Saved>("DELETE", `/lyrics/${lyricId}/revisions/pending`, {
				token: "owner-token",
				body: {},
			})
			expect(withdraw.json.data.revision).toMatchObject({ revNo: 4, status: "withdrawn" })
		})

		it("adds the revision bar to the lyric detail response", async () => {
			await saveAsOwner(swapWords(LRC, 15))
			const { json } = await lyricDetail()
			expect(json.data.revision).toMatchObject({
				revNo: 1,
				count: 2,
				pending: { revNo: 2, pendingReason: "large_text_drift" },
				lastRejected: null,
				updatedAt: expect.any(Number),
			})
			expect(json.data.revision.pending?.textDrift).toBeGreaterThan(0.15)
			expect(json.data.revision.pending?.timingDrift).toBe(0)
		})

		it("serves a council member the queue and applies decisions", async () => {
			await seedCouncilMember(db, COUNCIL_KEY)
			await saveAsOwner(swapWords(LRC, 15))
			const queue = await call<PendingRevisionCard[]>("GET", "/lyrics/revisions/pending/bot", {
				token: BOT_SECRET,
			})
			expect(queue.status).toBe(200)
			const [card] = queue.json.data
			expect(card).toMatchObject({ lyricsId: lyricId, revNo: 2, liveRevNo: 1 })

			const reject = await call<Saved>(
				"POST",
				`/lyrics/${lyricId}/revisions/${card.revisionId}/reject/bot`,
				{ token: BOT_SECRET, body: { keyId: COUNCIL_KEY, note: "Keep the hymn text" } }
			)
			expect(reject.json.data.revision).toMatchObject({ status: "rejected" })
			const detail = await lyricDetail()
			expect(detail.json.data.revision.lastRejected).toEqual({
				revNo: 2,
				reviewNote: "Keep the hymn text",
			})
		})
	})

	describe("patches", () => {
		const STRANGER_KEY = "b".repeat(64)

		beforeEach(async () => {
			const stranger = await seedUser(db, STRANGER_KEY)
			await seedLyric(db, stranger, { lyrics: LRC, format: "lrc", videoId: "strangerown" })
			seedSession(db, "stranger-token", STRANGER_KEY)
		})

		const propose = (lyrics: string, token = "stranger-token", note?: unknown) =>
			call<Saved>("POST", `/lyrics/${lyricId}/revisions`, {
				token,
				body: { lyrics, format: "lrc", language: "en", note },
			})

		it("shows a stranger's suggestion beside the bar's pending field, never in it", async () => {
			const preset = AVATAR_PRESETS[0]
			await db.pool.query(
				"UPDATE users SET avatar_type = 'preset', avatar_ref = $1 WHERE key_id = $2",
				[preset.id, STRANGER_KEY]
			)
			const patch = (await propose(swapWords(LRC, 1), "stranger-token", "  Fixed verse two  ")).json
				.data.revision
			const bar = (await lyricDetail()).json.data.revision
			expect(bar.pending).toBeNull()
			expect(bar.suggestion).toEqual({
				id: patch.id,
				revNo: 2,
				author: { displayName: expect.any(String) },
				authorKeyId: STRANGER_KEY,
				authorAvatarUrl: config.avatar.cdnBase + preset.file,
				pendingReason: "suggested",
				sealed: false,
				createdAt: patch.createdAt,
				councilDecidesAt: patch.createdAt + config.revisions.ownerDecisionSec,
				note: "Fixed verse two",
			})
		})

		it("reports a saved suggestion's reason as null and keeps suggested for the bar", async () => {
			const saved = await propose(swapWords(LRC, 1))
			expect(saved.json.data.revision).toMatchObject({ status: "pending", pendingReason: null })
			expect((await lyricDetail()).json.data.revision.suggestion?.pendingReason).toBe("suggested")
		})

		it("keeps a pending suggestion out of the history but serves it by id", async () => {
			const patch = (await propose(swapWords(LRC, 1))).json.data.revision
			expect((await listRevisions()).json.data.revisions.map((r) => r.revNo)).toEqual([1])

			const detail = await call<RevisionDetail>("GET", `/lyrics/${lyricId}/revisions/${patch.id}`)
			expect(detail.json.data).toMatchObject({
				id: patch.id,
				status: "pending",
				pendingReason: null,
			})
			expect(detail.json.data.lyrics).toBe(swapWords(LRC, 1))
			const diff = await call<RevisionDiff>("GET", `/lyrics/${lyricId}/revisions/${patch.id}/diff`)
			expect(diff.json.data.againstRevNo).toBe(1)

			await call("POST", `/lyrics/${lyricId}/revisions/${patch.id}/approve`, {
				token: "owner-token",
				body: {},
			})
			const [latest] = (await listRevisions()).json.data.revisions
			expect(latest).toMatchObject({ id: patch.id, status: "live", pendingReason: null })
		})

		it("regression: never reports a rejected suggestion as the owner's last rejected edit", async () => {
			await seedCouncilMember(db, COUNCIL_KEY)
			const patch = (await propose(swapWords(LRC, 1))).json.data.revision
			const decline = await call<Saved>("POST", `/lyrics/${lyricId}/revisions/${patch.id}/reject`, {
				token: "owner-token",
				body: {},
			})
			expect(decline.json.data.revision).toMatchObject({ status: "rejected" })
			expect((await lyricDetail()).json.data.revision.lastRejected).toBeNull()

			const ownEdit = (await saveAsOwner(swapWords(LRC, 15))).json.data.revision
			await call("POST", `/lyrics/${lyricId}/revisions/${ownEdit.id}/reject/bot`, {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY, note: "Keep the hymn text" },
			})
			expect((await lyricDetail()).json.data.revision.lastRejected).toEqual({
				revNo: ownEdit.revNo,
				reviewNote: "Keep the hymn text",
			})
		})

		it("refuses a note over the limit and stores nothing", async () => {
			const tooLong = "x".repeat(config.revisions.maxNoteLength + 1)
			const res = await propose(swapWords(LRC, 1), "stranger-token", tooLong)
			expect([res.status, res.json.code]).toEqual([400, "INVALID_PAYLOAD"])
			expect(res.json.hint).toContain(String(config.revisions.maxNoteLength))
			const { rows } = await db.pool.query(
				"SELECT count(*)::int AS n FROM lyric_revisions WHERE lyrics_id = $1",
				[lyricId]
			)
			expect(rows[0].n).toBeLessThanOrEqual(1)
			expect((await lyricDetail()).json.data.revision.suggestion).toBeUndefined()
		})

		it("lists the suggestions on the caller's own lyrics in the owner inbox", async () => {
			const patch = (await propose(swapWords(LRC, 1), "stranger-token", "Fixed verse two")).json
				.data.revision
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1700000000 WHERE id = $1", [
				lyricId,
			])
			const inbox = await call<unknown[]>("GET", "/lyrics/mine/suggestions", {
				token: "owner-token",
			})
			expect(inbox.status).toBe(200)
			expect(inbox.json.data).toEqual([
				{
					lyricsId: lyricId,
					videoId: expect.any(String),
					song: expect.any(String),
					artist: expect.any(String),
					suggestion: expect.objectContaining({
						id: patch.id,
						pendingReason: "suggested",
						sealed: true,
						authorAvatarUrl: null,
						note: "Fixed verse two",
					}),
				},
			])
			const strangerInbox = await call<unknown[]>("GET", "/lyrics/mine/suggestions", {
				token: "stranger-token",
			})
			expect(strangerInbox.json.data).toEqual([])
			const anonymous = await call("GET", "/lyrics/mine/suggestions")
			expect([anonymous.status, anonymous.json.code]).toEqual([401, "AUTH_REQUIRED"])
		})

		it("refuses an owner inbox read that only names the owner's key", async () => {
			await propose(swapWords(LRC, 1))
			const unverified = await call("GET", "/lyrics/mine/suggestions", {
				headers: { "x-key-id": OWNER_KEY },
			})
			expect([unverified.status, unverified.json.code]).toEqual([401, "AUTH_REQUIRED"])
		})

		it("maps patch failures to their status and code", async () => {
			await seedCouncilMember(db, COUNCIL_KEY)
			await saveAsOwner(swapWords(LRC, 15))
			const taken = await propose(swapWords(LRC, 1))
			expect([taken.status, taken.json.code]).toEqual([409, "PROPOSAL_OPEN"])

			await call("DELETE", `/lyrics/${lyricId}/revisions/pending`, {
				token: "owner-token",
				body: {},
			})
			const patch = (await propose(swapWords(LRC, 1))).json.data.revision
			const path = (action: string) => `/lyrics/${lyricId}/revisions/${patch.id}/${action}/bot`
			const early = await call("POST", path("approve"), {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY },
			})
			expect([early.status, early.json.code]).toEqual([409, "OWNER_WINDOW_OPEN"])
			const own = await call("POST", path("reject"), {
				token: BOT_SECRET,
				body: { keyId: STRANGER_KEY },
			})
			expect([own.status, own.json.code]).toEqual([403, "OWN_SUGGESTION"])
		})

		it("refuses a suggestion from an account with no lyric of its own on every write path", async () => {
			const newcomerKey = "d".repeat(64)
			await seedUser(db, newcomerKey)
			seedSession(db, "newcomer-token", newcomerKey)
			const body = { lyrics: swapWords(LRC, 1), format: "lrc", language: "en" }
			for (const path of ["", "/preview", "/compare"]) {
				const { status, json } = await call("POST", `/lyrics/${lyricId}/revisions${path}`, {
					token: "newcomer-token",
					body,
				})
				expect([status, json.code]).toEqual([403, "SUGGEST_NEEDS_LYRIC"])
				expect(json.hint).toBeTruthy()
			}
			expect((await listRevisions()).json.data.revisions).toHaveLength(1)
		})
	})

	describe("edge cases", () => {
		it("keeps an absent language and ISRC and clears one sent as null", async () => {
			const liveMetadata = async () =>
				(await db.pool.query("SELECT language, isrc FROM lyrics WHERE id = $1", [lyricId])).rows[0]
			await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc", isrc: "USRC17607839" },
			})
			expect(await liveMetadata()).toEqual({ language: "en", isrc: "USRC17607839" })

			const cleared = await call<Saved>("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 2), format: "lrc", isrc: null },
			})
			expect(cleared.status).toBe(200)
			expect(await liveMetadata()).toEqual({ language: "en", isrc: null })
		})
	})

	describe("album", () => {
		const liveAlbum = async () =>
			(await db.pool.query("SELECT album FROM lyrics WHERE id = $1", [lyricId])).rows[0].album
		const saveBody = (body: Record<string, unknown>) =>
			call<Saved>("POST", `/lyrics/${lyricId}/revisions`, { token: "owner-token", body })

		it("sets, keeps, and clears the album through the body", async () => {
			expect((await saveBody({ lyrics: LRC, format: "lrc", album: " Hymns " })).status).toBe(200)
			expect(await liveAlbum()).toBe("Hymns")

			expect((await saveBody({ lyrics: swapWords(LRC, 1), format: "lrc" })).status).toBe(200)
			expect(await liveAlbum()).toBe("Hymns")

			expect(
				(await saveBody({ lyrics: swapWords(LRC, 1), format: "lrc", album: null })).status
			).toBe(200)
			expect(await liveAlbum()).toBeNull()
		})

		it("returns the album in the revision detail", async () => {
			const saved = await saveBody({ lyrics: LRC, format: "lrc", album: "Hymns" })
			const detail = await call<RevisionDetail>(
				"GET",
				`/lyrics/${lyricId}/revisions/${saved.json.data.revision.id}`
			)
			expect(detail.json.data.album).toBe("Hymns")
		})

		describe("error paths", () => {
			it("rejects an album that is not a string or null", async () => {
				for (const album of [42, true, ["Hymns"], { name: "Hymns" }]) {
					const { status, json } = await saveBody({
						lyrics: swapWords(LRC, 1),
						format: "lrc",
						album,
					})
					expect([status, json.code]).toEqual([400, "INVALID_PAYLOAD"])
				}
			})

			it("rejects an over-long album with a hint", async () => {
				const max = config.validation.album.maxLength
				const { status, json } = await saveBody({
					lyrics: swapWords(LRC, 1),
					format: "lrc",
					album: "x".repeat(max + 1),
				})
				expect([status, json.code, json.hint]).toEqual([
					400,
					"INVALID_PAYLOAD",
					`Album names must be a single line of up to ${max} characters.`,
				])
				expect((await listRevisions()).json.data.revisions).toHaveLength(1)
			})
		})
	})

	describe("error paths", () => {
		it("requires auth to save", async () => {
			const unsigned = await call("POST", `/lyrics/${lyricId}/revisions`, {
				body: { lyrics: swapWords(LRC, 1), format: "lrc" },
			})
			expect([unsigned.status, unsigned.json.code]).toEqual([400, "INVALID_SIGNED_BODY"])

			const unknownToken = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "expired-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc" },
			})
			expect([unknownToken.status, unknownToken.json.code]).toEqual([401, "AUTH_REQUIRED"])

			const noBody = await call("DELETE", `/lyrics/${lyricId}/revisions/pending`)
			expect([noBody.status, noBody.json.code]).toEqual([401, "AUTH_REQUIRED"])

			expect((await listRevisions()).json.data.revisions).toHaveLength(1)
		})

		it("maps each save failure to its status and code", async () => {
			const stranger = "b".repeat(64)
			await seedUser(db, stranger)
			seedSession(db, "stranger-token", stranger)
			const rev1 = (await listRevisions()).json.data.revisions[0].id
			const notOwner = await call("POST", `/lyrics/${lyricId}/revisions/${rev1}/revert`, {
				token: "stranger-token",
				body: {},
			})
			expect([notOwner.status, notOwner.json.code]).toEqual([403, "NOT_OWNER"])

			const noChanges = await saveAsOwner(LRC)
			expect([noChanges.status, noChanges.json.code]).toEqual([409, "NO_CHANGES"])

			const missing = await call("POST", "/lyrics/999999/revisions", {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc" },
			})
			expect([missing.status, missing.json.code]).toEqual([404, "NOT_FOUND"])

			const badBody = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 1), format: "srt" },
			})
			expect([badBody.status, badBody.json.code]).toEqual([400, "INVALID_PAYLOAD"])

			const badTtml = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: "<tt><body><div><p>unclosed", format: "ttml" },
			})
			expect([badTtml.status, badTtml.json.code]).toEqual([400, "TTML_MALFORMED"])
		})

		it("returns 429 once the daily lyric limit is used", async () => {
			for (let i = 1; i <= 5; i++) await saveAsOwner(swapWords(LRC, i))
			const { status, json } = await saveAsOwner(swapWords(LRC, 6))
			expect([status, json.code]).toEqual([429, "RATE_LIMITED"])
			expect(json.hint).toMatch(/edit limit/)
		})

		it("throttles previews with the request limiter", async () => {
			const refusing = {
				async limit() {
					return { success: false }
				},
			}
			const { status, json } = await call("POST", `/lyrics/${lyricId}/revisions/preview`, {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc", language: "en" },
				env: { ...db.env, RATE_LIMITER: refusing } as unknown as Env,
			})
			expect([status, json.code]).toEqual([429, "RATE_LIMITED"])
			expect(json.hint).toBe("Too many checks at once. Wait a moment and try again.")
		})

		it("returns 409 STALE when the lyric keeps changing while saving", async () => {
			const sealed = () =>
				db.pool.query("UPDATE lyrics SET committee_approved_at = 1700000000 WHERE id = $1", [
					lyricId,
				])
			const unsealed = () =>
				db.pool.query("UPDATE lyrics SET committee_approved_at = NULL WHERE id = $1", [lyricId])
			await sealed()
			const env = {
				...db.env,
				DB: new InterleavedDb(db.pool, { before: unsealed, after: sealed }),
				JEV: { check: async () => ({ flagged: false, probability: 0.1 }) },
			}
			const { status, json } = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc", language: "en" },
				env,
			})
			expect([status, json.code]).toEqual([409, "STALE"])
			expect(json.hint).toBe("This lyric changed while saving. Try again.")
		})

		it("rejects a non-numeric id", async () => {
			const { status, json } = await call("GET", "/lyrics/abc/revisions")
			expect([status, json.code]).toEqual([400, "INVALID_ID"])
		})

		it("refuses the bot routes without the bot secret", async () => {
			const { status } = await call("GET", "/lyrics/revisions/pending/bot", { token: "nope" })
			expect(status).toBe(401)
		})

		it("maps council failures to NOT_COMMITTEE, ALREADY_DECIDED, and STALE", async () => {
			await seedCouncilMember(db, COUNCIL_KEY)
			const first = (await saveAsOwner(swapWords(LRC, 15))).json.data.revision
			const second = (await saveAsOwner(swapWords(LRC, 16))).json.data.revision
			const path = (id: number, action: string) =>
				`/lyrics/${lyricId}/revisions/${id}/${action}/bot`

			const outsider = await call("POST", path(second.id, "approve"), {
				token: BOT_SECRET,
				body: { keyId: OWNER_KEY },
			})
			expect([outsider.status, outsider.json.code]).toEqual([403, "NOT_COMMITTEE"])

			const unknownKey = await call("POST", path(second.id, "approve"), {
				token: BOT_SECRET,
				body: { keyId: "f".repeat(64) },
			})
			expect([unknownKey.status, unknownKey.json.code]).toEqual([403, "NOT_COMMITTEE"])

			const stale = await call("POST", path(first.id, "approve"), {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY },
			})
			expect([stale.status, stale.json.code]).toEqual([409, "STALE"])

			await call("POST", path(second.id, "approve"), {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY },
			})
			const again = await call("POST", path(second.id, "reject"), {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY },
			})
			expect([again.status, again.json.code]).toEqual([409, "ALREADY_DECIDED"])
		})
	})

	describe("invariants", () => {
		it("shows a pending save, a withdraw, and a council decision on the detail right away", async () => {
			await seedCouncilMember(db, COUNCIL_KEY)
			expect((await lyricDetail()).json.data.revision.pending).toBeNull()

			await saveAsOwner(swapWords(LRC, 15))
			expect((await lyricDetail()).json.data.revision.pending).toMatchObject({ revNo: 2 })

			await call("DELETE", `/lyrics/${lyricId}/revisions/pending`, {
				token: "owner-token",
				body: {},
			})
			expect((await lyricDetail()).json.data.revision.pending).toBeNull()

			const pending = (await saveAsOwner(swapWords(LRC, 16))).json.data.revision
			expect((await lyricDetail()).json.data.revision.pending).toMatchObject({ revNo: 3 })

			await call("POST", `/lyrics/${lyricId}/revisions/${pending.id}/approve/bot`, {
				token: BOT_SECRET,
				body: { keyId: COUNCIL_KEY },
			})
			const approved = (await lyricDetail()).json.data
			expect(approved.revision).toMatchObject({ revNo: 3, count: 3, pending: null })
			expect(approved.lyrics).toBe(swapWords(LRC, 16))
		})

		it("a failed save leaves the revision count and the live lyric unchanged", async () => {
			const before = (await lyricDetail()).json.data
			const failures = [
				await saveAsOwner(LRC),
				await call("POST", `/lyrics/${lyricId}/revisions`, {
					token: "owner-token",
					body: { lyrics: "<tt><body><div><p>unclosed", format: "ttml" },
				}),
				await call("POST", `/lyrics/${lyricId}/revisions`, {
					token: "owner-token",
					body: { lyrics: swapWords(LRC, 1), format: "lrc", isrc: "not-an-isrc" },
				}),
			]
			expect(failures.map((f) => f.status)).toEqual([409, 400, 400])
			expect((await listRevisions()).json.data.revisions).toHaveLength(1)
			const after = (await lyricDetail()).json.data
			expect(after.lyrics).toBe(before.lyrics)
			expect(after.revision).toEqual(before.revision)
		})
	})

	describe("regressions", () => {
		it("regression: the static bot queue path is not captured by the :id revision routes", async () => {
			const { status, json } = await call("GET", "/lyrics/revisions/pending/bot", {
				token: BOT_SECRET,
			})
			expect(status).toBe(200)
			expect(json).toEqual({ success: true, data: [] })
		})

		it("regression: the existing seal queue still answers after the revision routes mount", async () => {
			const { status } = await call("GET", "/lyrics/queue/bot", { token: BOT_SECRET })
			expect(status).toBe(200)
		})

		it("regression: a resend laid out differently is no change, a small nudge still is", async () => {
			const ttml = readRevisionFixture("amazing-grace.ttml")
			lyricId = await seedLyric(db, owner, { lyrics: ttml, format: "ttml", language: "en" })
			const reformatted = ttml
				.replace('begin="12.000" end="12.600"', 'end="00:12.600" begin="00:12.000"')
				.replaceAll('itunes:key="L1" ttm:agent="v1"', 'ttm:agent="v1" itunes:key="L1"')
			const nudged = ttml.replace('begin="12.600" end="13.200"', 'begin="12.630" end="13.200"')
			const compare = (lyrics: string) =>
				call<{ same: boolean }>("POST", `/lyrics/${lyricId}/revisions/compare`, {
					token: "owner-token",
					body: { lyrics, format: "ttml" },
				})

			expect((await compare(reformatted)).json.data.same).toBe(true)
			expect((await compare(nudged)).json.data.same).toBe(false)
			const preview = await call<PreviewResult>("POST", `/lyrics/${lyricId}/revisions/preview`, {
				token: "owner-token",
				body: { lyrics: reformatted, format: "ttml" },
			})
			expect(preview.json.data.noChanges).toBe(true)
			const saved = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "owner-token",
				body: { lyrics: reformatted, format: "ttml" },
			})
			expect(saved.json.code).toBe("NO_CHANGES")
		})
	})
})
