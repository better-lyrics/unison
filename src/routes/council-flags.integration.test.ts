import type { CouncilFlagItem } from "@/db/council-flags"
import { submitReport } from "@/db/reports"
import {
	BOT_SECRET,
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { committeeBotRoutes } from "./committee"
import { councilRoutes } from "./council"

const MIRA = "b1".repeat(32)
const OLA = "b2".repeat(32)
const KAI = "b3".repeat(32)
const STRANGER = "b4".repeat(32)
const SUBMITTER = "b5".repeat(32)
const VIDEO = "LZTOfQiudx0"
const LRC = readRevisionFixture("amazing-grace.lrc")
const kid = (n: number): string => n.toString(16).padStart(64, "0")

interface Envelope<T> {
	success: boolean
	data: T
	code?: string
	hint?: string
}

describeIntegration("council flag routes (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	let lyricsId: number
	let caseId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	const reporter = async (n: number): Promise<number> => {
		const id = await seedUser(db, kid(n))
		await db.pool.query("UPDATE users SET reputation = 1.0, vote_count = 5 WHERE id = $1", [id])
		return id
	}

	const flag = async (target: number, from: number): Promise<number> => {
		for (let i = 0; i < 3; i++) {
			await submitReport(db.env, target, await reporter(from + i), {
				reason: "spam",
				details: i === 0 ? "copied from a bot" : undefined,
			})
		}
		const { rows } = await db.pool.query<{ id: number }>(
			"SELECT id FROM report_cases WHERE lyrics_id = $1 AND status = 'open'",
			[target]
		)
		return Number(rows[0].id)
	}

	beforeEach(async () => {
		await wipeRevisionData(db)
		await seedCouncilMember(db, MIRA)
		await seedCouncilMember(db, OLA)
		await seedCouncilMember(db, KAI)
		await seedUser(db, STRANGER)
		submitter = await seedUser(db, SUBMITTER)
		lyricsId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
		caseId = await flag(lyricsId, 10)
		seedSession(db, "mira", MIRA)
		seedSession(db, "ola", OLA)
		seedSession(db, "kai", KAI)
		seedSession(db, "stranger", STRANGER)
	})

	const app = () => new Elysia().use(committeeBotRoutes(db.env)).use(councilRoutes(db.env))

	const call = async <T = unknown>(
		method: string,
		path: string,
		opts: { token?: string; body?: unknown } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (opts.token) headers.authorization = `Bearer ${opts.token}`
		const res = await app().handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			})
		)
		return { status: res.status, json: (await res.json()) as Envelope<T> }
	}

	const vote = (id: number, token: string, body: unknown) =>
		call<{ status: string; removals: number; keeps: number; needed: number }>(
			"POST",
			`/committee/flags/${id}/vote`,
			{
				token,
				body,
			}
		)

	const caseStatus = async (id = caseId) => {
		const { rows } = await db.pool.query<{ status: string }>(
			"SELECT status FROM report_cases WHERE id = $1",
			[id]
		)
		return rows[0]?.status
	}

	describe("GET /committee/flags", () => {
		describe("happy paths", () => {
			it("lists open cases with council people and the quorum", async () => {
				await vote(caseId, "mira", { remove: true })
				const res = await call<{ items: CouncilFlagItem[]; needed: number }>(
					"GET",
					"/committee/flags",
					{ token: "kai" }
				)
				expect(res.status).toBe(200)
				expect(res.json.data.needed).toBe(3)
				const [item] = res.json.data.items
				expect(item).toMatchObject({
					id: caseId,
					lyricsId,
					videoId: VIDEO,
					song: "Amazing Grace",
					artist: "Traditional",
					openedAt: expect.any(Number),
				})
				expect(item.submitter?.keyId).toBe(SUBMITTER)
				expect(item.submitter).toHaveProperty("tier")
				expect(item.reports).toHaveLength(3)
				expect(item.reports[0]).toEqual({
					reason: "spam",
					details: "copied from a bot",
					reporter: expect.objectContaining({ keyId: kid(10), tier: null }),
					createdAt: expect.any(Number),
				})
				expect(item.removers.map((p) => p.keyId)).toEqual([MIRA])
				expect(item.keepers).toEqual([])
				expect(item).not.toHaveProperty("removerIds")
				expect(item).not.toHaveProperty("submitterId")
			})
		})

		describe("edge cases", () => {
			it("returns an empty list when nothing is flagged", async () => {
				await db.pool.query("DELETE FROM report_cases")
				const res = await call<{ items: CouncilFlagItem[] }>("GET", "/committee/flags", {
					token: "kai",
				})
				expect(res.json.data.items).toEqual([])
			})
		})

		describe("error paths", () => {
			it("refuses a non-member", async () => {
				const res = await call("GET", "/committee/flags", { token: "stranger" })
				expect(res.status).toBe(403)
				expect(res.json.code).toBe("NOT_COMMITTEE")
			})
		})
	})

	describe("POST /committee/flags/:id/vote", () => {
		describe("happy paths", () => {
			it("returns the removal count while the case stays open", async () => {
				const res = await vote(caseId, "mira", { remove: true, note: "spam account" })
				expect(res.status).toBe(200)
				expect(res.json.data).toEqual({ status: "open", removals: 1, keeps: 0, needed: 3 })
			})

			it("keeps the lyric on one keep vote and evicts its cache", async () => {
				db.cache.store.set(`v:${VIDEO}`, "stale")
				const res = await vote(caseId, "mira", { remove: false })
				expect(res.status).toBe(200)
				expect(res.json.data).toEqual({ status: "kept", removals: 0, keeps: 1, needed: 3 })
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			})

			it("removes the lyric at the quorum and evicts its cache", async () => {
				await vote(caseId, "mira", { remove: true })
				await vote(caseId, "ola", { remove: true })
				db.cache.store.set(`v:${VIDEO}`, "stale")
				const res = await vote(caseId, "kai", { remove: true })
				expect(res.status).toBe(200)
				expect(res.json.data).toEqual({ status: "removed", removals: 3, keeps: 0, needed: 3 })
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			})
		})

		describe("error paths", () => {
			it("rejects a bad id", async () => {
				const res = await vote(0, "mira", { remove: true })
				expect(res.status).toBe(400)
				expect(res.json.code).toBe("INVALID_ID")
			})

			it("rejects a non-boolean remove", async () => {
				const res = await vote(caseId, "mira", { remove: "yes" })
				expect(res.status).toBe(400)
				expect(res.json.code).toBe("INVALID_PAYLOAD")
			})

			it("rejects an oversized note", async () => {
				const res = await vote(caseId, "mira", { remove: true, note: "x".repeat(5000) })
				expect(res.status).toBe(400)
				expect(res.json.code).toBe("INVALID_PAYLOAD")
			})

			it("refuses a non-member", async () => {
				const res = await vote(caseId, "stranger", { remove: true })
				expect(res.status).toBe(403)
				expect(res.json.code).toBe("NOT_COMMITTEE")
			})

			it("returns 404 for a missing case", async () => {
				const res = await vote(caseId + 1000, "mira", { remove: true })
				expect(res.status).toBe(404)
				expect(res.json.code).toBe("NOT_FOUND")
			})

			it("returns 409 once the case is closed", async () => {
				await vote(caseId, "mira", { remove: false })
				const res = await vote(caseId, "ola", { remove: true })
				expect(res.status).toBe(409)
				expect(res.json.code).toBe("ALREADY_DECIDED")
			})

			it("returns FLAG_CONFLICT when the submitter votes", async () => {
				await db.pool.query(
					"INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')",
					[submitter]
				)
				seedSession(db, "submitter", SUBMITTER)
				const res = await vote(caseId, "submitter", { remove: false })
				expect(res.status).toBe(409)
				expect(res.json.code).toBe("FLAG_CONFLICT")
				expect(await caseStatus()).toBe("open")
			})
		})

		describe("invariants", () => {
			it("does not close the case on a rejected vote", async () => {
				await vote(caseId, "stranger", { remove: false })
				expect(await caseStatus()).toBe("open")
			})
		})
	})

	const botCall = async <T = unknown>(
		method: string,
		path: string,
		opts: { secret?: string; body?: unknown } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (opts.secret) headers.authorization = `Bearer ${opts.secret}`
		const res = await app().handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			})
		)
		return { status: res.status, json: (await res.json()) as Envelope<T> }
	}

	const botVote = (id: number, body: unknown, secret = BOT_SECRET) =>
		botCall<{ status: string; removals: number; keeps: number; needed: number }>(
			"POST",
			`/committee/flags/${id}/vote/bot`,
			{ secret, body }
		)

	interface BotCase {
		id: number
		lyricsId: number
		videoId: string
		song: string
		artist: string
		submitterName: string | null
		openedAt: number
		status: "open" | "removed" | "kept"
		decidedAt: number | null
		reports: { reason: string; details: string | null; createdAt: number }[]
		removals: number
		keeps: number
	}

	const botList = (secret?: string) =>
		botCall<{ needed: number; cases: BotCase[] }>("GET", "/committee/flags/bot", { secret })

	const closeAgo = async (target: number, seconds: number) => {
		const now = Math.floor(Date.now() / 1000)
		await db.pool.query("UPDATE reports SET created_at = $2 WHERE lyrics_id = $1", [
			target,
			now - seconds - 200,
		])
		await db.pool.query(
			"UPDATE report_cases SET status = 'removed', opened_at = $2, decided_at = $3 WHERE lyrics_id = $1",
			[target, now - seconds - 100, now - seconds]
		)
	}

	describe("GET /committee/flags/bot", () => {
		describe("happy paths", () => {
			it("returns the open case with the exact bot fields", async () => {
				await db.pool.query("UPDATE users SET nickname = 'Lyricsmith' WHERE id = $1", [submitter])
				await vote(caseId, "mira", { remove: true })
				const res = await botList(BOT_SECRET)
				expect(res.status).toBe(200)
				expect(res.json).toEqual({
					success: true,
					data: {
						needed: 3,
						cases: [
							{
								id: caseId,
								lyricsId,
								videoId: VIDEO,
								song: "Amazing Grace",
								artist: "Traditional",
								submitterName: "Lyricsmith",
								openedAt: expect.any(Number),
								status: "open",
								decidedAt: null,
								reports: [
									{ reason: "spam", details: "copied from a bot", createdAt: expect.any(Number) },
									{ reason: "spam", details: null, createdAt: expect.any(Number) },
									{ reason: "spam", details: null, createdAt: expect.any(Number) },
								],
								removals: 1,
								keeps: 0,
							},
						],
					},
				})
			})

			it("includes a case closed an hour ago and drops one closed 25 hours ago", async () => {
				const recent = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "dQw4w9WgXcQ",
				})
				const old = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: "HsBfV2A5dUY",
				})
				const recentCase = await flag(recent, 30)
				await flag(old, 40)
				await closeAgo(recent, 60 * 60)
				await closeAgo(old, 25 * 60 * 60)
				const res = await botList(BOT_SECRET)
				expect(res.json.data.cases.map((c) => c.id).sort()).toEqual([caseId, recentCase].sort())
				const closed = res.json.data.cases.find((c) => c.id === recentCase)
				expect(closed).toMatchObject({ status: "removed", decidedAt: expect.any(Number) })
				expect(closed?.reports).toHaveLength(3)
			})
		})

		describe("edge cases", () => {
			it("falls back to the generated name when the submitter has no nickname", async () => {
				const res = await botList(BOT_SECRET)
				expect(res.json.data.cases[0].submitterName).toEqual(expect.any(String))
				expect(res.json.data.cases[0].submitterName).not.toBe("")
			})
		})

		describe("error paths", () => {
			it("refuses a missing bot secret", async () => {
				const res = await botList()
				expect(res.status).toBe(401)
				expect(res.json.code).toBe("AUTH_REQUIRED")
			})

			it("refuses a wrong bot secret", async () => {
				expect((await botList("nope")).status).toBe(401)
			})
		})

		describe("invariants", () => {
			it("is not shadowed by the member gated list", async () => {
				const res = await botList(BOT_SECRET)
				expect(res.status).toBe(200)
				expect(res.json.data).toHaveProperty("cases")
			})
		})
	})

	describe("POST /committee/flags/:id/vote/bot", () => {
		describe("happy paths", () => {
			it("counts toward the same quorum as web votes", async () => {
				await vote(caseId, "mira", { remove: true })
				await vote(caseId, "ola", { remove: true })
				db.cache.store.set(`v:${VIDEO}`, "stale")
				const res = await botVote(caseId, { keyId: KAI, remove: true, note: "spam" })
				expect(res.status).toBe(200)
				expect(res.json.data).toEqual({ status: "removed", removals: 3, keeps: 0, needed: 3 })
				expect(await caseStatus()).toBe("removed")
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			})

			it("keeps the lyric and evicts its cache", async () => {
				db.cache.store.set(`v:${VIDEO}`, "stale")
				const res = await botVote(caseId, { keyId: MIRA, remove: false })
				expect(res.json.data).toEqual({ status: "kept", removals: 0, keeps: 1, needed: 3 })
				expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			})

			it("records the vote as a discord event", async () => {
				await botVote(caseId, { keyId: MIRA, remove: true })
				const { rows } = await db.pool.query(
					"SELECT kind, source FROM council_events WHERE ref_id = $1 AND kind LIKE 'flag_%'",
					[caseId]
				)
				expect(rows).toEqual([{ kind: "flag_remove", source: "discord" }])
			})
		})

		describe("error paths", () => {
			it("refuses a wrong bot secret", async () => {
				const res = await botVote(caseId, { keyId: MIRA, remove: true }, "nope")
				expect(res.status).toBe(401)
				expect(await caseStatus()).toBe("open")
			})

			it("refuses an unknown key id", async () => {
				const res = await botVote(caseId, { keyId: "ff".repeat(32), remove: true })
				expect(res.status).toBe(403)
				expect(res.json.code).toBe("NOT_COMMITTEE")
			})

			it("refuses a non-member", async () => {
				const res = await botVote(caseId, { keyId: STRANGER, remove: true })
				expect(res.status).toBe(403)
				expect(res.json.code).toBe("NOT_COMMITTEE")
			})

			it("returns FLAG_CONFLICT when a reporter votes", async () => {
				await db.pool.query(
					"INSERT INTO committee_members (user_id, added_by) VALUES ((SELECT id FROM users WHERE key_id = $1), 'test')",
					[kid(10)]
				)
				const res = await botVote(caseId, { keyId: kid(10), remove: true })
				expect(res.status).toBe(409)
				expect(res.json.code).toBe("FLAG_CONFLICT")
			})

			it("returns 409 once the case is closed", async () => {
				await botVote(caseId, { keyId: MIRA, remove: false })
				const res = await botVote(caseId, { keyId: OLA, remove: true })
				expect(res.status).toBe(409)
				expect(res.json.code).toBe("ALREADY_DECIDED")
			})

			it("returns 404 for a missing case", async () => {
				const res = await botVote(caseId + 1000, { keyId: MIRA, remove: true })
				expect(res.status).toBe(404)
			})

			it("rejects a non-boolean remove", async () => {
				const res = await botVote(caseId, { keyId: MIRA, remove: "yes" })
				expect(res.status).toBe(422)
			})
		})
	})
})
