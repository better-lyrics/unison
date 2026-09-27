import { readFileSync } from "node:fs"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { canStartNewAttempt } from "@/utils/exam-retake"
import { hashExamToken } from "@/utils/exam-token"
import type { AnswerKey } from "@/utils/exam-types"
import pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	type ExamQuestionInput,
	getLatestSessionByKeyId,
	getSessionByTokenHash,
	getSessionQuestions,
	listApplicantReports,
	listApplicants,
	loadDrawableBank,
	markExamStarted,
	recordDecision,
	recordGrade,
	resolveCandidateName,
	resolveExamSession,
	retireQuestionsExcept,
	saveAnswer,
	startAttempt,
	startSession,
	upsertQuestions,
} from "./exam"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const KEY = (c: string) => c.repeat(64)
const SOON = Math.floor(Date.now() / 1000) + 3600
const verdictKey: AnswerKey = {
	parts: [{ id: "verdict", points: { no: 3, seal: -1 }, overSeal: "seal" }],
}

function question(id: number, category: string, weight = 1): ExamQuestionInput {
	return { id, type: "timing", category, prompt: `q${id}`, answerKey: verdictKey, weight }
}

describeIntegration("exam data access (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool) } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM exam_session_question")
		await pool.query("DELETE FROM exam_session")
		await pool.query("DELETE FROM exam_question")
	}
	beforeEach(wipe)

	async function seedBank() {
		await upsertQuestions(env, [
			question(1, "seal-or-not"),
			question(2, "seal-or-not"),
			question(3, "a-vs-b"),
		])
	}

	it("upserts the bank and loads only active drawable questions", async () => {
		await seedBank()
		await upsertQuestions(env, [{ ...question(4, "a-vs-b"), active: false }])
		const bank = await loadDrawableBank(env)
		expect(bank.map((q) => q.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
	})

	it("retires questions absent from the bank so removing one drops it from draws", async () => {
		await seedBank()
		await retireQuestionsExcept(env, [1, 3])
		const bank = await loadDrawableBank(env)
		expect(bank.map((q) => q.id).sort((a, b) => a - b)).toEqual([1, 3])
		const rows = await pool.query("SELECT active FROM exam_question WHERE id = 2")
		expect(rows.rows[0].active).toBe(false)
	})

	it("re-upserts by id (idempotent), keeping one row and applying edits", async () => {
		await upsertQuestions(env, [question(1, "seal-or-not")])
		await upsertQuestions(env, [{ ...question(1, "a-vs-b", 5) }])
		const rows = await pool.query("SELECT category, weight FROM exam_question WHERE id = 1")
		expect(rows.rowCount).toBe(1)
		expect(rows.rows[0].category).toBe("a-vs-b")
		expect(Number(rows.rows[0].weight)).toBe(5)
	})

	it("starts a session with ordered questions and resolves it by token hash", async () => {
		await seedBank()
		const session = await startSession(
			env,
			{
				keyId: KEY("a"),
				discordId: "d1",
				tokenHash: "hash-a",
				seed: 42,
				expiresAt: SOON,
				isDev: false,
			},
			[3, 1, 2]
		)
		expect(session.state).toBe("in_progress")

		const resolved = await getSessionByTokenHash(env, "hash-a")
		expect(resolved?.id).toBe(session.id)

		const questions = await getSessionQuestions(env, session.id)
		expect(questions.map((q) => q.questionId)).toEqual([3, 1, 2])
		expect(questions[0].position).toBe(0)
		expect(questions[0].answer).toBeNull()
	})

	it("stamps the exam clock once and keeps it stable across reopens", async () => {
		await seedBank()
		const session = await startSession(
			env,
			{ keyId: KEY("a"), discordId: null, tokenHash: "h", seed: 1, expiresAt: SOON, isDev: false },
			[1]
		)
		expect((await getLatestSessionByKeyId(env, KEY("a")))?.examStartedAt).toBeNull()

		const first = await markExamStarted(env, session.id)
		expect(first).toBeGreaterThan(0)
		expect((await getLatestSessionByKeyId(env, KEY("a")))?.examStartedAt).toBe(first)

		// A second Begin (a reopen) must not reset the clock.
		await new Promise((r) => setTimeout(r, 1100))
		const second = await markExamStarted(env, session.id)
		expect(second).toBe(first)
	})

	it("persists an autosaved answer", async () => {
		await seedBank()
		const session = await startSession(
			env,
			{ keyId: KEY("a"), discordId: null, tokenHash: "h", seed: 1, expiresAt: SOON, isDev: false },
			[1]
		)
		await saveAnswer(env, session.id, 1, { verdict: "no" })
		const questions = await getSessionQuestions(env, session.id)
		expect(questions[0].answer).toEqual({ verdict: "no" })
	})

	it("records the grade and flips state, keeping the hash for a submitted reload", async () => {
		await seedBank()
		const token = "raw-token-value"
		const session = await startSession(
			env,
			{
				keyId: KEY("a"),
				discordId: null,
				tokenHash: await hashExamToken(token),
				seed: 1,
				expiresAt: SOON,
				isDev: false,
			},
			[1, 2]
		)
		expect((await resolveExamSession(env, token)).ok).toBe(true)
		await recordGrade(env, session.id, {
			state: "pending_review",
			score: 6,
			maxScore: 6,
			cutoff: 5.1,
			submittedAt: 1234,
			perQuestion: [
				{ questionId: 1, awardedPoints: 3, maxPoints: 3 },
				{ questionId: 2, awardedPoints: 3, maxPoints: 3 },
			],
		})
		const stored = await getLatestSessionByKeyId(env, KEY("a"))
		expect(stored?.state).toBe("pending_review")
		expect(stored?.score).toBe(6)

		const resolved = await resolveExamSession(env, token)
		expect(resolved).toEqual({ ok: false, reason: "submitted" })
	})

	it("lists applicants with a per-category breakdown, ordered by score", async () => {
		await seedBank()
		const low = await startSession(
			env,
			{ keyId: KEY("a"), discordId: "d1", tokenHash: "h1", seed: 1, expiresAt: SOON, isDev: false },
			[1, 3]
		)
		const high = await startSession(
			env,
			{ keyId: KEY("b"), discordId: "d2", tokenHash: "h2", seed: 2, expiresAt: SOON, isDev: false },
			[2]
		)
		await recordGrade(env, low.id, {
			state: "pending_review",
			score: 4,
			maxScore: 6,
			cutoff: 5.1,
			submittedAt: 100,
			perQuestion: [
				{ questionId: 1, awardedPoints: 3, maxPoints: 3 },
				{ questionId: 3, awardedPoints: 1, maxPoints: 3 },
			],
		})
		await recordGrade(env, high.id, {
			state: "pending_review",
			score: 3,
			maxScore: 3,
			cutoff: 2.5,
			submittedAt: 200,
			perQuestion: [{ questionId: 2, awardedPoints: 3, maxPoints: 3 }],
		})

		const applicants = await listApplicants(env, false)
		expect(applicants.map((a) => a.score)).toEqual([4, 3])
		const first = applicants[0]
		const sealArea = first.breakdown.find((b) => b.section === "seal-or-not")
		expect(sealArea).toEqual({ section: "seal-or-not", score: 3, max: 3 })
	})

	it("excludes failed applicants unless includeBelowCutoff is set", async () => {
		await seedBank()
		const failed = await startSession(
			env,
			{ keyId: KEY("c"), discordId: "d3", tokenHash: "h3", seed: 1, expiresAt: SOON, isDev: false },
			[1]
		)
		await recordGrade(env, failed.id, {
			state: "failed",
			score: 1,
			maxScore: 3,
			cutoff: 2.5,
			submittedAt: 100,
			perQuestion: [{ questionId: 1, awardedPoints: 1, maxPoints: 3 }],
		})
		expect(await listApplicants(env, false)).toHaveLength(0)
		expect(await listApplicants(env, true)).toHaveLength(1)
	})

	it("records a decision only from a decidable state", async () => {
		await seedBank()
		const session = await startSession(
			env,
			{ keyId: KEY("a"), discordId: "d1", tokenHash: "h", seed: 1, expiresAt: SOON, isDev: false },
			[1]
		)
		expect(
			await recordDecision(env, session.id, "approve", { source: "discord", discordId: "admin1" })
		).toBe(false) // still in_progress
		await recordGrade(env, session.id, {
			state: "pending_review",
			score: 3,
			maxScore: 3,
			cutoff: 2.5,
			submittedAt: 100,
			perQuestion: [{ questionId: 1, awardedPoints: 3, maxPoints: 3 }],
		})
		expect(
			await recordDecision(env, session.id, "approve", { source: "discord", discordId: "admin1" })
		).toBe(true)
		expect(
			await recordDecision(env, session.id, "reject", { source: "discord", discordId: "admin2" })
		).toBe(false) // already decided
		const stored = await getLatestSessionByKeyId(env, KEY("a"))
		expect(stored?.state).toBe("approved")
		expect(stored?.decidedByDiscordId).toBe("admin1")
	})

	describe("superseded attempts", () => {
		async function failedAttempt(tokenHash: string, submittedAt: number) {
			const session = await startSession(
				env,
				{ keyId: KEY("a"), discordId: "d1", tokenHash, seed: 1, expiresAt: SOON, isDev: false },
				[1]
			)
			await recordGrade(env, session.id, {
				state: "failed",
				score: 1,
				maxScore: 3,
				cutoff: 2.55,
				submittedAt,
				perQuestion: [{ questionId: 1, awardedPoints: 1, maxPoints: 3 }],
			})
			return session
		}

		it("lists only the newest attempt per account as an applicant", async () => {
			await seedBank()
			await failedAttempt("h1", 100)
			const retake = await failedAttempt("h2", 200)
			expect((await listApplicants(env, true)).map((a) => a.applicantId)).toEqual([retake.id])
		})

		it("refuses a decision on an attempt a retake has replaced", async () => {
			await seedBank()
			const first = await failedAttempt("h1", 100)
			const retake = await failedAttempt("h2", 200)
			expect(
				await recordDecision(env, first.id, "approve", { source: "discord", discordId: "admin1" })
			).toBe(false)
			expect(
				await recordDecision(env, retake.id, "approve", { source: "discord", discordId: "admin1" })
			).toBe(true)
			expect((await getLatestSessionByKeyId(env, KEY("a")))?.state).toBe("approved")
		})

		it("regression: cannot approve an old attempt while its retake is in progress", async () => {
			await seedBank()
			const first = await failedAttempt("h1", 100)
			await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: "d1",
					tokenHash: "h2",
					seed: 2,
					expiresAt: SOON,
					isDev: false,
				},
				[2]
			)
			expect(
				await recordDecision(env, first.id, "approve", { source: "discord", discordId: "admin1" })
			).toBe(false)
			expect(await listApplicants(env, true)).toHaveLength(0)
		})

		it("keeps every attempt in the user's report history", async () => {
			await seedBank()
			const first = await failedAttempt("h1", 100)
			const retake = await failedAttempt("h2", 200)
			expect((await listApplicantReports(env, "d1")).map((r) => r.applicantId)).toEqual([
				retake.id,
				first.id,
			])
		})

		it("does not let another account's newer attempt supersede this one", async () => {
			await seedBank()
			const mine = await failedAttempt("h1", 100)
			await startSession(
				env,
				{
					keyId: KEY("b"),
					discordId: "d2",
					tokenHash: "h2",
					seed: 2,
					expiresAt: SOON,
					isDev: false,
				},
				[2]
			)
			expect(
				await recordDecision(env, mine.id, "approve", { source: "discord", discordId: "admin1" })
			).toBe(true)
		})
	})

	describe("startAttempt", () => {
		const admitByRule = (latest: NonNullable<Parameters<typeof canStartNewAttempt>[0]>) =>
			canStartNewAttempt(latest, config.exam.retakeCooldownSec, Math.floor(Date.now() / 1000))

		function attemptParams(keyId: string, tokenHash: string) {
			return { keyId, discordId: "d1", tokenHash, seed: 1, expiresAt: SOON, isDev: false }
		}

		async function failOldAttempt(keyId: string, tokenHash: string) {
			const session = await startSession(env, attemptParams(keyId, tokenHash), [1])
			await recordGrade(env, session.id, {
				state: "failed",
				score: 1,
				maxScore: 3,
				cutoff: 2.55,
				submittedAt: 100,
				perQuestion: [{ questionId: 1, awardedPoints: 1, maxPoints: 3 }],
			})
			return session
		}

		async function realRows(keyId: string) {
			const res = await pool.query<{ id: string; state: string }>(
				"SELECT id, state FROM exam_session WHERE key_id = $1 AND is_dev = FALSE ORDER BY id",
				[keyId]
			)
			return res.rows
		}

		it("starts a first attempt without consulting the retake rule", async () => {
			await seedBank()
			const result = await startAttempt(env, attemptParams(KEY("a"), "h1"), [1], () => false)
			expect(result.ok).toBe(true)
			expect(await realRows(KEY("a"))).toHaveLength(1)
		})

		it("hands the newest real attempt to the retake rule", async () => {
			await seedBank()
			const old = await failOldAttempt(KEY("a"), "h1")
			const seen: number[] = []
			await startAttempt(env, attemptParams(KEY("a"), "h2"), [2], (latest) => {
				seen.push(latest.id)
				return false
			})
			expect(seen).toEqual([old.id])
		})

		it("refuses without inserting when the rule rejects the latest attempt", async () => {
			await seedBank()
			const first = await startSession(env, attemptParams(KEY("a"), "h1"), [1])
			const result = await startAttempt(env, attemptParams(KEY("a"), "h2"), [2], admitByRule)
			expect(result).toEqual({ ok: false, latest: expect.objectContaining({ id: first.id }) })
			expect(await realRows(KEY("a"))).toHaveLength(1)
		})

		it("starts a retake once the rule admits the failed attempt", async () => {
			await seedBank()
			await failOldAttempt(KEY("a"), "h1")
			const result = await startAttempt(env, attemptParams(KEY("a"), "h2"), [2], admitByRule)
			expect(result.ok).toBe(true)
			expect((await realRows(KEY("a"))).map((r) => r.state)).toEqual(["failed", "in_progress"])
		})

		describe("invariants", () => {
			it("lets exactly one of two simultaneous starts through", async () => {
				await seedBank()
				const results = await Promise.all([
					startAttempt(env, attemptParams(KEY("a"), "h1"), [1], admitByRule),
					startAttempt(env, attemptParams(KEY("a"), "h2"), [2], admitByRule),
				])
				expect(results.filter((r) => r.ok)).toHaveLength(1)
				const loser = results.find((r) => !r.ok)
				expect(loser && !loser.ok && loser.latest.state).toBe("in_progress")
				expect(await realRows(KEY("a"))).toHaveLength(1)
			})

			it("regression: never both approves an old attempt and opens a retake for it", async () => {
				await seedBank()
				for (const c of ["p", "q", "r", "s", "t", "u", "v", "w"]) {
					const old = await failOldAttempt(KEY(c), `h-${c}`)
					const [approved, started] = await Promise.all([
						recordDecision(env, old.id, "approve", { source: "discord", discordId: "admin1" }),
						startAttempt(env, attemptParams(KEY(c), `h2-${c}`), [2], admitByRule),
					])
					expect(approved && started.ok).toBe(false)
					expect(approved || started.ok).toBe(true)
				}
			})
		})
	})

	describe("listApplicantReports", () => {
		async function gradedSession(
			key: string,
			discordId: string,
			opts: { submittedAt: number; isDev?: boolean; tokenHash: string }
		) {
			const session = await startSession(
				env,
				{
					keyId: key,
					discordId,
					tokenHash: opts.tokenHash,
					seed: 1,
					expiresAt: SOON,
					isDev: opts.isDev ?? false,
				},
				[1, 3]
			)
			await recordGrade(env, session.id, {
				state: "pending_review",
				score: 4,
				maxScore: 6,
				cutoff: 5.1,
				submittedAt: opts.submittedAt,
				perQuestion: [
					{ questionId: 1, awardedPoints: 3, maxPoints: 3 },
					{ questionId: 3, awardedPoints: 1, maxPoints: 3 },
				],
			})
			return session
		}

		it("keeps an approved applicant's report with its breakdown and decision", async () => {
			await seedBank()
			const session = await gradedSession(KEY("a"), "d1", { submittedAt: 100, tokenHash: "h1" })
			await recordDecision(env, session.id, "approve", { source: "discord", discordId: "admin1" })

			const [report] = await listApplicantReports(env, "d1")
			expect(report).toMatchObject({
				applicantId: session.id,
				discordId: "d1",
				score: 4,
				maxScore: 6,
				state: "approved",
				decidedByDiscordId: "admin1",
			})
			expect(report.decidedAt).toEqual(expect.any(Number))
			expect(report.breakdown).toContainEqual({ section: "seal-or-not", score: 3, max: 3 })
		})

		it("lists every graded attempt for the user, newest first", async () => {
			await seedBank()
			const older = await gradedSession(KEY("a"), "d1", { submittedAt: 100, tokenHash: "h1" })
			const newer = await gradedSession(KEY("b"), "d1", { submittedAt: 200, tokenHash: "h2" })
			const reports = await listApplicantReports(env, "d1")
			expect(reports.map((r) => r.applicantId)).toEqual([newer.id, older.id])
		})

		describe("edge cases", () => {
			it("returns nothing for a user who never took the exam", async () => {
				expect(await listApplicantReports(env, "nobody")).toEqual([])
			})

			it("skips attempts that are not graded yet", async () => {
				await seedBank()
				await startSession(
					env,
					{
						keyId: KEY("a"),
						discordId: "d1",
						tokenHash: "h",
						seed: 1,
						expiresAt: SOON,
						isDev: false,
					},
					[1]
				)
				expect(await listApplicantReports(env, "d1")).toEqual([])
			})

			it("skips dev sessions and other users", async () => {
				await seedBank()
				await gradedSession(KEY("a"), "d1", { submittedAt: 100, tokenHash: "h1", isDev: true })
				await gradedSession(KEY("b"), "d2", { submittedAt: 100, tokenHash: "h2" })
				expect(await listApplicantReports(env, "d1")).toEqual([])
			})
		})
	})

	describe("council log", () => {
		const APPLICANT = KEY("5")
		const ADMIN = KEY("6")
		const scopedUsers = [APPLICANT, ADMIN]
		const cleanup = async () => {
			await pool.query(
				"DELETE FROM council_events WHERE actor_id IN (SELECT id FROM users WHERE key_id = ANY($1)) OR subject_user_id IN (SELECT id FROM users WHERE key_id = ANY($1))",
				[scopedUsers]
			)
			await pool.query("DELETE FROM exam_session WHERE key_id = ANY($1)", [scopedUsers])
			await pool.query("DELETE FROM discord_links WHERE key_id = ANY($1)", [scopedUsers])
			await pool.query("DELETE FROM users WHERE key_id = ANY($1)", [scopedUsers])
		}
		beforeEach(cleanup)
		afterEach(cleanup)

		async function gradedApplicant(): Promise<{ sessionId: number; applicantId: number }> {
			await seedBank()
			const applicant = await pool.query<{ id: number }>(
				"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
				[APPLICANT]
			)
			const session = await startSession(
				env,
				{
					keyId: APPLICANT,
					discordId: "d-app",
					tokenHash: "h-log",
					seed: 1,
					expiresAt: SOON,
					isDev: false,
				},
				[1]
			)
			await recordGrade(env, session.id, {
				state: "pending_review",
				score: 3,
				maxScore: 3,
				cutoff: 2.5,
				submittedAt: 100,
				perQuestion: [{ questionId: 1, awardedPoints: 3, maxPoints: 3 }],
			})
			return { sessionId: session.id, applicantId: applicant.rows[0].id }
		}

		const events = async () => {
			const { rows } = await pool.query(
				"SELECT kind, source, actor_id, subject_user_id, ref_id::int AS ref_id FROM council_events WHERE kind LIKE 'applicant%' AND ref_id IN (SELECT id FROM exam_session WHERE key_id = $1)",
				[APPLICANT]
			)
			return rows
		}

		it("records a web decision with the admin user and logs it", async () => {
			const { sessionId, applicantId } = await gradedApplicant()
			const admin = await pool.query<{ id: number }>(
				"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
				[ADMIN]
			)
			await pool.query(
				"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ('d-admin', $1, 'admin')",
				[ADMIN]
			)
			expect(
				await recordDecision(env, sessionId, "approve", { source: "web", userId: admin.rows[0].id })
			).toBe(true)
			const { rows } = await pool.query(
				"SELECT decided_by_user_id, decided_by_discord_id FROM exam_session WHERE id = $1",
				[sessionId]
			)
			expect(rows[0]).toEqual({
				decided_by_user_id: admin.rows[0].id,
				decided_by_discord_id: "d-admin",
			})
			expect(await events()).toEqual([
				{
					kind: "applicant_approve",
					source: "web",
					actor_id: admin.rows[0].id,
					subject_user_id: applicantId,
					ref_id: sessionId,
				},
			])
		})

		it("resolves a Discord decider to their linked account", async () => {
			const { sessionId } = await gradedApplicant()
			const admin = await pool.query<{ id: number }>(
				"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
				[ADMIN]
			)
			await pool.query(
				"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ('d-admin', $1, 'admin')",
				[ADMIN]
			)
			await recordDecision(env, sessionId, "reject", { source: "discord", discordId: "d-admin" })
			const [event] = await events()
			expect(event).toMatchObject({
				kind: "applicant_reject",
				source: "discord",
				actor_id: admin.rows[0].id,
			})
		})

		it("logs an unlinked Discord decider without an actor", async () => {
			const { sessionId } = await gradedApplicant()
			await recordDecision(env, sessionId, "approve", { source: "discord", discordId: "d-nobody" })
			const [event] = await events()
			expect(event.actor_id).toBeNull()
		})

		it("logs nothing when the decision does not apply", async () => {
			const { sessionId } = await gradedApplicant()
			await recordDecision(env, sessionId, "approve", { source: "discord", discordId: "d1" })
			await recordDecision(env, sessionId, "reject", { source: "discord", discordId: "d1" })
			expect(await events()).toHaveLength(1)
		})
	})

	describe("resolveCandidateName", () => {
		// Suite-unique keys and scoped cleanup: other suites leave users their lyrics still reference.
		const LINKED_KEY = KEY("7")
		const UNLINKED_KEY = KEY("8")
		const removeCandidates = async () => {
			await pool.query("DELETE FROM discord_links WHERE key_id = ANY($1)", [
				[LINKED_KEY, UNLINKED_KEY],
			])
			await pool.query("DELETE FROM users WHERE key_id = ANY($1)", [[LINKED_KEY, UNLINKED_KEY]])
		}
		beforeEach(removeCandidates)
		afterEach(removeCandidates)

		it("prefers the Discord username over the Better Lyrics nickname", async () => {
			const key = LINKED_KEY
			await pool.query("INSERT INTO users (key_id, nickname) VALUES ($1, $2)", [key, "BLName"])
			await pool.query(
				"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ($1, $2, $3)",
				["disc-c", key, "discord_name"]
			)
			expect(await resolveCandidateName(env, key)).toBe("discord_name")
		})

		it("falls back to the Better Lyrics nickname when there is no Discord link", async () => {
			const key = UNLINKED_KEY
			await pool.query("INSERT INTO users (key_id, nickname) VALUES ($1, $2)", [key, "BLName"])
			expect(await resolveCandidateName(env, key)).toBe("BLName")
		})
	})

	describe("resolveExamSession", () => {
		it("reports an unknown token as invalid", async () => {
			expect(await resolveExamSession(env, "nope")).toEqual({ ok: false, reason: "invalid" })
		})

		it("reports an expired in_progress session as expired", async () => {
			await seedBank()
			const token = "expired-token"
			await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: null,
					tokenHash: await hashExamToken(token),
					seed: 1,
					expiresAt: 100,
					isDev: false,
				},
				[1]
			)
			expect(await resolveExamSession(env, token)).toEqual({ ok: false, reason: "expired" })
		})
	})

	describe("invariants", () => {
		it("allows only one open real attempt per account", async () => {
			await seedBank()
			await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: null,
					tokenHash: "h1",
					seed: 1,
					expiresAt: SOON,
					isDev: false,
				},
				[1]
			)
			await expect(
				startSession(
					env,
					{
						keyId: KEY("a"),
						discordId: null,
						tokenHash: "h2",
						seed: 2,
						expiresAt: SOON,
						isDev: false,
					},
					[2]
				)
			).rejects.toThrow()
		})

		it("allows a retake row once the earlier attempt is graded, and looks up the newest", async () => {
			await seedBank()
			const first = await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: "d1",
					tokenHash: "h1",
					seed: 1,
					expiresAt: SOON,
					isDev: false,
				},
				[1]
			)
			await recordGrade(env, first.id, {
				state: "failed",
				score: 0,
				maxScore: 3,
				cutoff: 2.55,
				submittedAt: 100,
				perQuestion: [{ questionId: 1, awardedPoints: 0, maxPoints: 3 }],
			})
			const retake = await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: "d1",
					tokenHash: "h2",
					seed: 2,
					expiresAt: SOON,
					isDev: false,
				},
				[2]
			)
			const latest = await getLatestSessionByKeyId(env, KEY("a"))
			expect(latest?.id).toBe(retake.id)
			expect(latest?.state).toBe("in_progress")
			expect((await getSessionQuestions(env, first.id)).map((q) => q.questionId)).toEqual([1])
			expect((await listApplicantReports(env, "d1")).map((r) => r.applicantId)).toEqual([first.id])
		})

		it("keeps the latest lookup blind to dev sessions", async () => {
			await seedBank()
			const real = await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: null,
					tokenHash: "h1",
					seed: 1,
					expiresAt: SOON,
					isDev: false,
				},
				[1]
			)
			await startSession(
				env,
				{
					keyId: KEY("a"),
					discordId: null,
					tokenHash: "h2",
					seed: 2,
					expiresAt: SOON,
					isDev: true,
				},
				[2]
			)
			expect((await getLatestSessionByKeyId(env, KEY("a")))?.id).toBe(real.id)
		})

		it("exempts dev sessions from the one-attempt rule", async () => {
			await seedBank()
			await startSession(
				env,
				{
					keyId: KEY("z"),
					discordId: null,
					tokenHash: null,
					seed: 1,
					expiresAt: SOON,
					isDev: true,
				},
				[1]
			)
			await expect(
				startSession(
					env,
					{
						keyId: KEY("z"),
						discordId: null,
						tokenHash: null,
						seed: 2,
						expiresAt: SOON,
						isDev: true,
					},
					[2]
				)
			).resolves.toBeDefined()
		})
	})
})
