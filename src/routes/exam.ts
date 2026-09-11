import { config } from "@/config"
import {
	type ExamQuestionInput,
	type ResolveExamResult,
	getSessionById,
	getSessionByKeyId,
	getSessionQuestion,
	getSessionQuestions,
	listApplicants,
	loadDrawableBank,
	markExamStarted,
	recordDecision,
	recordGrade,
	reissueToken,
	resolveCandidateName,
	resolveExamSession,
	saveAnswer,
	startSession,
	upsertQuestions,
} from "@/db/exam"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedAdmin } from "@/utils/admin-auth"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { toClientQuestion } from "@/utils/exam-client"
import { type DrawSlot, drawQuestions } from "@/utils/exam-draw"
import { gradeExam, toGradeableItems } from "@/utils/exam-grading"
import { isScenarioTerminated } from "@/utils/exam-scenario"
import { generateExamToken, hashExamToken } from "@/utils/exam-token"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"

const DEV_KEY = "d".repeat(64)

const ONE_SHOT_CATEGORY = "capstone"

function sameAnswer(a: Record<string, string>, b: Record<string, string>): boolean {
	const ak = Object.keys(a)
	const bk = Object.keys(b)
	return ak.length === bk.length && ak.every((k) => a[k] === b[k])
}

const RESOLVE_ERROR: Record<
	Extract<ResolveExamResult, { ok: false }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	invalid: { status: 401, code: ErrorCode.EXAM_TOKEN_INVALID },
	expired: { status: 410, code: ErrorCode.EXAM_TOKEN_EXPIRED },
	submitted: { status: 409, code: ErrorCode.EXAM_ALREADY_SUBMITTED },
}

function randomSeed(): number {
	return Math.floor(Math.random() * 0x100000000)
}

function isAbsoluteHttpUrl(url: string): boolean {
	return /^https?:\/\//.test(url)
}

function examBaseUrl(env: Env): string {
	if (env.EXAM_BASE_URL) return env.EXAM_BASE_URL
	if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`
	return ""
}

function examUrl(env: Env, token: string): string {
	return `${examBaseUrl(env)}/exam?t=${token}`
}

async function mintSession(
	env: Env,
	params: {
		keyId: string
		discordId: string | null
		seed: number
		isDev: boolean
		drawShape?: readonly DrawSlot[]
	}
) {
	const bank = await loadDrawableBank(env)
	const orderedIds = drawQuestions(bank, params.drawShape ?? config.exam.draw, params.seed)
	const token = generateExamToken()
	const tokenHash = await hashExamToken(token)
	const expiresAt = Math.floor(Date.now() / 1000) + config.exam.tokenTtlSec
	const session = await startSession(
		env,
		{
			keyId: params.keyId,
			discordId: params.discordId,
			tokenHash,
			seed: params.seed,
			expiresAt,
			isDev: params.isDev,
		},
		orderedIds
	)
	return { session, token, expiresAt }
}

const answerKeySchema = t.Object({
	parts: t.Array(
		t.Object({
			id: t.String(),
			points: t.Record(t.String(), t.Number()),
			overSeal: t.Optional(t.String()),
		})
	),
})

const questionSchema = t.Object({
	id: t.Number(),
	type: t.Union([t.Literal("timing"), t.Literal("mcq"), t.Literal("scenario")]),
	category: t.String(),
	prompt: t.String(),
	assets: t.Optional(t.Unknown()),
	choices: t.Optional(t.Unknown()),
	answerKey: answerKeySchema,
	weight: t.Number(),
	steps: t.Optional(t.Unknown()),
	active: t.Optional(t.Boolean()),
})

export const examRoutes = (env: Env) =>
	new Elysia({ prefix: "/exam" })
		.decorate("env", env)
		.post(
			"/bot/start",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				if (!isAbsoluteHttpUrl(examBaseUrl(env))) {
					return status(500, buildError(ErrorCode.EXAM_NOT_CONFIGURED))
				}
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) return status(404, buildError(ErrorCode.NOT_FOUND))

				const existing = await getSessionByKeyId(env, body.keyId)
				if (existing) {
					if (existing.state === "in_progress") {
						const token = generateExamToken()
						const expiresAt = Math.floor(Date.now() / 1000) + config.exam.tokenTtlSec
						await reissueToken(env, existing.id, await hashExamToken(token), expiresAt)
						return {
							success: true,
							data: { status: "eligible", examUrl: examUrl(env, token), expiresAt },
						}
					}
					return {
						success: true,
						data: {
							status: "already_attempted",
							attempt: {
								state: existing.state,
								score: existing.score ?? undefined,
								submittedAt: existing.submittedAt ?? undefined,
							},
						},
					}
				}

				const { token, expiresAt } = await mintSession(env, {
					keyId: body.keyId,
					discordId: body.discordId,
					seed: randomSeed(),
					isDev: false,
				})
				return {
					success: true,
					data: { status: "eligible", examUrl: examUrl(env, token), expiresAt },
				}
			},
			{ body: t.Object({ keyId: t.String(), discordId: t.String() }) }
		)
		.get(
			"/bot/applicants",
			async ({ env, headers, query, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const applicants = await listApplicants(env, query.includeBelowCutoff === "true")
				return { success: true, data: { applicants } }
			},
			{ query: t.Object({ includeBelowCutoff: t.Optional(t.String()) }) }
		)
		.post(
			"/bot/applicants/:applicantId/decision",
			async ({ env, headers, params, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = Number(params.applicantId)
				if (!Number.isInteger(id)) return status(400, buildError(ErrorCode.INVALID_ID))
				const ok = await recordDecision(env, id, body.decision, body.deciderDiscordId)
				if (!ok) return status(404, buildError(ErrorCode.EXAM_SESSION_NOT_FOUND))
				return { success: true }
			},
			{
				params: t.Object({ applicantId: t.String() }),
				body: t.Object({
					decision: t.Union([t.Literal("approve"), t.Literal("reject")]),
					deciderDiscordId: t.String(),
				}),
			}
		)
		.get(
			"/session",
			async ({ env, query, status }) => {
				if (!query.t) return status(401, buildError(ErrorCode.EXAM_TOKEN_INVALID))
				const resolved = await resolveExamSession(env, query.t)
				if (!resolved.ok) {
					const mapped = RESOLVE_ERROR[resolved.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				const session = resolved.session
				const questions = await getSessionQuestions(env, session.id)
				const savedAnswers: Record<number, unknown> = {}
				const terminatedQuestionIds: number[] = []
				for (const q of questions) {
					if (q.answer !== null) savedAnswers[q.questionId] = q.answer
					if (q.category === ONE_SHOT_CATEGORY && isScenarioTerminated(q.answerKey, q.answer)) {
						terminatedQuestionIds.push(q.questionId)
					}
				}
				return {
					success: true,
					data: {
						candidate: { displayName: await resolveCandidateName(env, session.keyId) },
						questions: questions.map(toClientQuestion),
						timeLimitSec: config.exam.timeLimitSec,
						expiresAt: session.expiresAt,
						examStartedAt: session.examStartedAt,
						savedAnswers,
						terminatedQuestionIds,
					},
				}
			},
			{ query: t.Object({ t: t.Optional(t.String()) }) }
		)
		.post(
			"/begin",
			async ({ env, body, status }) => {
				const resolved = await resolveExamSession(env, body.t)
				if (!resolved.ok) {
					const mapped = RESOLVE_ERROR[resolved.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				const examStartedAt = await markExamStarted(env, resolved.session.id)
				return { success: true, data: { examStartedAt } }
			},
			{ body: t.Object({ t: t.String() }) }
		)
		.post(
			"/answer",
			async ({ env, body, status }) => {
				const resolved = await resolveExamSession(env, body.t)
				if (!resolved.ok) {
					const mapped = RESOLVE_ERROR[resolved.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				const question = await getSessionQuestion(env, resolved.session.id, body.questionId)
				if (question?.category === ONE_SHOT_CATEGORY) {
					const stored = (question.answer as Record<string, string> | null) ?? {}
					// Finality: a committed beat can never be changed or dropped.
					for (const [beat, choice] of Object.entries(stored)) {
						if (body.answer[beat] !== choice) {
							return status(409, buildError(ErrorCode.EXAM_ANSWER_LOCKED))
						}
					}
					// Once a wrong beat has ended the story, no further beats may be committed.
					if (isScenarioTerminated(question.answerKey, stored) && !sameAnswer(body.answer, stored)) {
						return status(409, buildError(ErrorCode.EXAM_ANSWER_LOCKED))
					}
					await saveAnswer(env, resolved.session.id, body.questionId, body.answer)
					return {
						success: true,
						data: { terminated: isScenarioTerminated(question.answerKey, body.answer) },
					}
				}
				await saveAnswer(env, resolved.session.id, body.questionId, body.answer)
				return { success: true }
			},
			{
				body: t.Object({
					t: t.String(),
					questionId: t.Number(),
					answer: t.Record(t.String(), t.String()),
				}),
			}
		)
		.post(
			"/submit",
			async ({ env, body, status }) => {
				const resolved = await resolveExamSession(env, body.t)
				if (!resolved.ok) {
					const mapped = RESOLVE_ERROR[resolved.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				const session = resolved.session
				const questions = await getSessionQuestions(env, session.id)
				const clientAnswers = { ...body.answers }
				for (const q of questions) {
					if (q.category === ONE_SHOT_CATEGORY) delete clientAnswers[String(q.questionId)]
				}
				const items = toGradeableItems(questions, clientAnswers)
				const grade = gradeExam(items, {
					cutoffPct: config.exam.cutoffPct,
					overSealPenaltyRatio: config.exam.overSealPenaltyRatio,
				})
				await recordGrade(env, session.id, {
					state: grade.passed ? "pending_review" : "failed",
					score: grade.score,
					maxScore: grade.maxScore,
					cutoff: grade.maxScore * config.exam.cutoffPct,
					submittedAt: Math.floor(Date.now() / 1000),
					perQuestion: grade.questions.map((q) => ({
						questionId: q.questionId,
						awardedPoints: q.awardedPoints,
						maxPoints: q.maxPoints,
					})),
				})
				return { success: true, data: { state: "submitted" } }
			},
			{
				body: t.Object({
					t: t.String(),
					answers: t.Record(t.String(), t.Record(t.String(), t.String())),
				}),
			}
		)
		.post(
			"/admin/questions",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedAdmin(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const upserted = await upsertQuestions(env, body.questions as ExamQuestionInput[])
				return { success: true, data: { upserted } }
			},
			{ body: t.Object({ questions: t.Array(questionSchema) }) }
		)
		.post(
			"/dev/start",
			async ({ env, body, status }) => {
				if (!env.EXAM_DEV_ENABLED) return status(404, buildError(ErrorCode.NOT_FOUND))
				const { session, token, expiresAt } = await mintSession(env, {
					keyId: body.keyId ?? DEV_KEY,
					discordId: null,
					seed: body.seed ?? 1,
					isDev: true,
				})
				return {
					success: true,
					data: { sessionId: session.id, token, examUrl: examUrl(env, token), expiresAt },
				}
			},
			{ body: t.Object({ keyId: t.Optional(t.String()), seed: t.Optional(t.Number()) }) }
		)
		.get(
			"/dev/start",
			async ({ env, query, status }) => {
				if (!env.EXAM_DEV_ENABLED) return status(404, buildError(ErrorCode.NOT_FOUND))
				const drawShape: readonly DrawSlot[] = query.only
					? [{ category: query.only, count: 50 }]
					: config.exam.draw
				const seed = query.seed ? Number(query.seed) : 1
				const { token } = await mintSession(env, {
					keyId: DEV_KEY,
					discordId: null,
					seed: Number.isFinite(seed) ? seed : 1,
					isDev: true,
					drawShape,
				})
				return new Response(null, { status: 302, headers: { location: examUrl(env, token) } })
			},
			{ query: t.Object({ only: t.Optional(t.String()), seed: t.Optional(t.String()) }) }
		)
		.get(
			"/dev/result",
			async ({ env, query, status }) => {
				if (!env.EXAM_DEV_ENABLED) return status(404, buildError(ErrorCode.NOT_FOUND))
				const id = Number(query.sessionId)
				if (!Number.isInteger(id)) return status(400, buildError(ErrorCode.INVALID_ID))
				const session = await getSessionById(env, id)
				if (!session) return status(404, buildError(ErrorCode.EXAM_SESSION_NOT_FOUND))
				const questions = await getSessionQuestions(env, id)
				const breakdownMap = new Map<string, { section: string; score: number; max: number }>()
				for (const q of questions) {
					const area = breakdownMap.get(q.category) ?? { section: q.category, score: 0, max: 0 }
					area.score += q.awardedPoints ?? 0
					area.max += q.maxPoints ?? 0
					breakdownMap.set(q.category, area)
				}
				return {
					success: true,
					data: {
						session: {
							id: session.id,
							state: session.state,
							score: session.score,
							maxScore: session.maxScore,
							cutoff: session.cutoff,
							submittedAt: session.submittedAt,
							seed: session.seed,
							isDev: session.isDev,
						},
						perQuestion: questions.map((q) => ({
							questionId: q.questionId,
							category: q.category,
							awardedPoints: q.awardedPoints,
							maxPoints: q.maxPoints,
							answer: q.answer,
						})),
						breakdown: [...breakdownMap.values()],
					},
				}
			},
			{ query: t.Object({ sessionId: t.String() }) }
		)
