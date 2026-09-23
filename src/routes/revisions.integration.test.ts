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
		opts: { token?: string; body?: unknown; env?: Env } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json" }
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
				drift: { textLimit: 0.15, timingLimit: 0.3 },
				rateLimit: { lyricRemaining: 5, userRemaining: 20 },
			})
			expect(json.data.checks.map((c) => c.field)).toEqual(["lyrics", "language", "isrc"])
			expect((await listRevisions()).json.data.revisions).toHaveLength(1)
		})

		it("lists, reads, and diffs revisions without auth", async () => {
			await saveAsOwner(swapWords(LRC, 1))
			const list = await listRevisions()
			expect(list.status).toBe(200)
			const [latest] = list.json.data.revisions
			const detail = await call<RevisionDetail>("GET", `/lyrics/${lyricId}/revisions/${latest.id}`)
			expect(detail.json.data).toMatchObject({ revNo: 2, format: "lrc", language: "en" })
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
			const notOwner = await call("POST", `/lyrics/${lyricId}/revisions`, {
				token: "stranger-token",
				body: { lyrics: swapWords(LRC, 1), format: "lrc" },
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
			expect(json.hint).toBe("Too many checks at once. Wait a moment and keep typing.")
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
	})
})
