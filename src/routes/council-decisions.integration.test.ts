import { listCouncilEvents } from "@/db/council-events"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture, swapWords } from "@/test/lyric-fixtures"
import type { Env, RevisionSummary } from "@/types"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { reviewQueueRoutes } from "./review-queue"
import { revisionRoutes } from "./revisions"

const OWNER_KEY = "f1".repeat(32)
const COUNCIL_KEY = "f2".repeat(32)
const STRANGER_KEY = "f3".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")

interface Envelope<T> {
	success: boolean
	data: T
	code?: string
}

const buildApp = (env: Env) => new Elysia().use(reviewQueueRoutes(env)).use(revisionRoutes(env))

describeIntegration("council decisions from the web (integration)", () => {
	let db: IntegrationDb
	let lyricId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		const owner = await seedUser(db, OWNER_KEY)
		await seedCouncilMember(db, COUNCIL_KEY)
		await seedUser(db, STRANGER_KEY)
		lyricId = await seedLyric(db, owner, { lyrics: LRC, format: "lrc" })
		seedSession(db, "owner-token", OWNER_KEY)
		seedSession(db, "council-token", COUNCIL_KEY)
		seedSession(db, "stranger-token", STRANGER_KEY)
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

	const log = async () =>
		(await listCouncilEvents(db.env, { includeBookmarks: false, limit: 20 })).events

	describe("rejecting a seal candidate", () => {
		it("rejects with a trimmed note and logs it from the web", async () => {
			const res = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: { note: "  Chorus timing lands early.  " },
			})
			expect(res.status).toBe(200)
			const [event] = await log()
			expect(event).toMatchObject({
				kind: "reject",
				source: "web",
				note: "Chorus timing lands early.",
			})
		})

		it("rejects without a body", async () => {
			const res = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: {},
			})
			expect(res.status).toBe(200)
			expect((await log())[0].note).toBeNull()
		})

		it("undoes a rejection", async () => {
			await call("POST", `/lyrics/${lyricId}/reject`, { token: "council-token", body: {} })
			const res = await call("DELETE", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: {},
			})
			expect(res.status).toBe(200)
			expect((await log()).map((e) => e.kind)).toEqual(["unreject", "reject"])
		})

		it("maps a second rejection to 409", async () => {
			await call("POST", `/lyrics/${lyricId}/reject`, { token: "council-token", body: {} })
			const res = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: {},
			})
			expect(res.status).toBe(409)
			expect(res.json.code).toBe("REJECT_ALREADY_ACTIVE")
		})

		it("refuses a non-member, a missing session and a bad id", async () => {
			expect(
				(await call("POST", `/lyrics/${lyricId}/reject`, { token: "stranger-token", body: {} }))
					.status
			).toBe(403)
			expect((await call("POST", `/lyrics/${lyricId}/reject`)).status).toBe(401)
			expect(
				(await call("POST", "/lyrics/abc/reject", { token: "council-token", body: {} })).status
			).toBe(400)
			expect(
				(await call("DELETE", `/lyrics/${lyricId}/reject`, { token: "council-token", body: {} }))
					.status
			).toBe(404)
		})

		it("refuses a note that is too long or not text", async () => {
			const long = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: { note: "x".repeat(1001) },
			})
			expect(long.status).toBe(400)
			const wrong = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: { note: 42 },
			})
			expect(wrong.status).toBe(400)
			expect(await log()).toEqual([])
		})

		it("throttles council writes", async () => {
			const limited = {
				...db.env,
				RATE_LIMITER: {
					async limit() {
						return { success: false }
					},
				},
			} as unknown as Env
			const res = await call("POST", `/lyrics/${lyricId}/reject`, {
				token: "council-token",
				body: {},
				env: limited,
			})
			expect(res.status).toBe(429)
		})
	})

	describe("deciding an edit", () => {
		async function pendingEdit(): Promise<number> {
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [lyricId])
			const saved = await call<{ revision: RevisionSummary }>(
				"POST",
				`/lyrics/${lyricId}/revisions`,
				{
					token: "owner-token",
					body: { lyrics: swapWords(LRC, 2), format: "lrc", language: "en" },
				}
			)
			expect(saved.json.data.revision.status).toBe("pending")
			return saved.json.data.revision.id
		}

		it("approves a pending edit", async () => {
			const revisionId = await pendingEdit()
			const res = await call<{ revision: RevisionSummary }>(
				"POST",
				`/lyrics/${lyricId}/revisions/${revisionId}/approve`,
				{ token: "council-token", body: {} }
			)
			expect(res.status).toBe(200)
			expect(res.json.data.revision.status).toBe("live")
			expect((await log())[0]).toMatchObject({ kind: "edit_approve", source: "web" })
		})

		it("rejects a pending edit with a note", async () => {
			const revisionId = await pendingEdit()
			const res = await call<{ revision: RevisionSummary }>(
				"POST",
				`/lyrics/${lyricId}/revisions/${revisionId}/reject`,
				{ token: "council-token", body: { note: "Keep the hymn text" } }
			)
			expect(res.status).toBe(200)
			expect(res.json.data.revision.reviewNote).toBe("Keep the hymn text")
		})

		it("maps an already decided edit to 409 and a stranger to 403", async () => {
			const revisionId = await pendingEdit()
			await call("POST", `/lyrics/${lyricId}/revisions/${revisionId}/approve`, {
				token: "council-token",
				body: {},
			})
			const again = await call("POST", `/lyrics/${lyricId}/revisions/${revisionId}/reject`, {
				token: "council-token",
				body: {},
			})
			expect(again.status).toBe(409)
			expect(again.json.code).toBe("ALREADY_DECIDED")
			const stranger = await call("POST", `/lyrics/${lyricId}/revisions/${revisionId}/approve`, {
				token: "stranger-token",
				body: {},
			})
			expect(stranger.status).toBe(403)
		})
	})
})
