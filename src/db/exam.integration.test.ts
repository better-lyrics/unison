import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { hashExamToken } from "@/utils/exam-token"
import type { AnswerKey } from "@/utils/exam-types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	type ExamQuestionInput,
	getSessionByKeyId,
	getSessionByTokenHash,
	getSessionQuestions,
	listApplicants,
	loadDrawableBank,
	recordDecision,
	recordGrade,
	resolveExamSession,
	saveAnswer,
	startSession,
	upsertQuestions,
} from "./exam"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const KEY = (c: string) => c.repeat(64)
const SOON = Math.floor(Date.now() / 1000) + 3600
const verdictKey: AnswerKey = { parts: [{ id: "verdict", points: { no: 3, seal: -1 }, overSeal: "seal" }] }

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
			{ keyId: KEY("a"), discordId: "d1", tokenHash: "hash-a", seed: 42, expiresAt: SOON, isDev: false },
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
			{ keyId: KEY("a"), discordId: null, tokenHash: await hashExamToken(token), seed: 1, expiresAt: SOON, isDev: false },
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
		const stored = await getSessionByKeyId(env, KEY("a"))
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
		expect(await recordDecision(env, session.id, "approve", "admin1")).toBe(false) // still in_progress
		await recordGrade(env, session.id, {
			state: "pending_review",
			score: 3,
			maxScore: 3,
			cutoff: 2.5,
			submittedAt: 100,
			perQuestion: [{ questionId: 1, awardedPoints: 3, maxPoints: 3 }],
		})
		expect(await recordDecision(env, session.id, "approve", "admin1")).toBe(true)
		expect(await recordDecision(env, session.id, "reject", "admin2")).toBe(false) // already decided
		const stored = await getSessionByKeyId(env, KEY("a"))
		expect(stored?.state).toBe("approved")
		expect(stored?.decidedByDiscordId).toBe("admin1")
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
				{ keyId: KEY("a"), discordId: null, tokenHash: await hashExamToken(token), seed: 1, expiresAt: 100, isDev: false },
				[1]
			)
			expect(await resolveExamSession(env, token)).toEqual({ ok: false, reason: "expired" })
		})
	})

	describe("invariants", () => {
		it("allows only one real attempt per account", async () => {
			await seedBank()
			await startSession(
				env,
				{ keyId: KEY("a"), discordId: null, tokenHash: "h1", seed: 1, expiresAt: SOON, isDev: false },
				[1]
			)
			await expect(
				startSession(
					env,
					{ keyId: KEY("a"), discordId: null, tokenHash: "h2", seed: 2, expiresAt: SOON, isDev: false },
					[2]
				)
			).rejects.toThrow()
		})

		it("exempts dev sessions from the one-attempt rule", async () => {
			await seedBank()
			await startSession(
				env,
				{ keyId: KEY("z"), discordId: null, tokenHash: null, seed: 1, expiresAt: SOON, isDev: true },
				[1]
			)
			await expect(
				startSession(
					env,
					{ keyId: KEY("z"), discordId: null, tokenHash: null, seed: 2, expiresAt: SOON, isDev: true },
					[2]
				)
			).resolves.toBeDefined()
		})
	})
})
