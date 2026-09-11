import * as examDb from "@/db/exam"
import { getUserByKeyId, resolveDisplayName } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedAdmin } from "@/utils/admin-auth"
import { isAuthorizedBot } from "@/utils/bot-auth"
import type { AnswerKey } from "@/utils/exam-types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { examRoutes } from "./exam"

vi.mock("@/utils/bot-auth", () => ({ isAuthorizedBot: vi.fn() }))
vi.mock("@/utils/admin-auth", () => ({ isAuthorizedAdmin: vi.fn() }))
vi.mock("@/db/users", () => ({ getUserByKeyId: vi.fn(), resolveDisplayName: vi.fn() }))
vi.mock("@/db/exam", () => ({
	getSessionByKeyId: vi.fn(),
	getSessionById: vi.fn(),
	getSessionQuestion: vi.fn(),
	getSessionQuestions: vi.fn(),
	listApplicants: vi.fn(),
	loadDrawableBank: vi.fn(),
	markExamStarted: vi.fn(),
	recordDecision: vi.fn(),
	recordGrade: vi.fn(),
	reissueToken: vi.fn(),
	resolveCandidateName: vi.fn(),
	resolveExamSession: vi.fn(),
	saveAnswer: vi.fn(),
	startSession: vi.fn(),
	upsertQuestions: vi.fn(),
}))

const KEY = "k".repeat(64)
const SOON = Math.floor(Date.now() / 1000) + 3600
const user = { id: 7, key_id: KEY } as unknown as Awaited<ReturnType<typeof getUserByKeyId>>

const botApp = () => examRoutes({ EXAM_BASE_URL: "https://unison.test" } as Env)
const spaApp = (env: Partial<Env> = {}) => examRoutes(env as Env)

function post(app: ReturnType<typeof botApp>, path: string, body: unknown, auth = true) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: {
				...(auth ? { authorization: "Bearer secret" } : {}),
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		})
	)
}

function get(app: ReturnType<typeof botApp>, path: string, auth = true) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: "GET",
			headers: auth ? { authorization: "Bearer secret" } : {},
		})
	)
}

const okSession = {
	id: 5,
	keyId: KEY,
	expiresAt: SOON,
	examStartedAt: null,
	state: "in_progress" as const,
}
const { startSession, loadDrawableBank } = examDb

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(startSession).mockResolvedValue({ id: 9 } as never)
	vi.mocked(loadDrawableBank).mockResolvedValue([])
	vi.mocked(resolveDisplayName).mockResolvedValue("Tester")
	vi.mocked(examDb.resolveCandidateName).mockResolvedValue("test_candidate")
})

describe("POST /exam/bot/start", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await post(botApp(), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		expect(res.status).toBe(401)
		expect(((await res.json()) as { code: string }).code).toBe("AUTH_REQUIRED")
	})

	it("returns 404 for an unresolved keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(null)
		const res = await post(botApp(), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		expect(res.status).toBe(404)
	})

	it("mints a new eligible session with an exam link when none exists", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(user)
		vi.mocked(examDb.getSessionByKeyId).mockResolvedValue(null)
		const res = await post(botApp(), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		const body = (await res.json()) as {
			data: { status: string; examUrl: string; expiresAt: number }
		}
		expect(body.data.status).toBe("eligible")
		expect(body.data.examUrl).toMatch(/^https:\/\/unison\.test\/exam\?t=[A-Za-z0-9_-]+$/)
		expect(typeof body.data.expiresAt).toBe("number")
		expect(vi.mocked(startSession)).toHaveBeenCalled()
	})

	it("derives an absolute link from RAILWAY_PUBLIC_DOMAIN when EXAM_BASE_URL is unset", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(user)
		vi.mocked(examDb.getSessionByKeyId).mockResolvedValue(null)
		const app = examRoutes({ RAILWAY_PUBLIC_DOMAIN: "unison.up.railway.app" } as Env)
		const res = await post(app, "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		const body = (await res.json()) as { data: { examUrl: string } }
		expect(body.data.examUrl).toMatch(/^https:\/\/unison\.up\.railway\.app\/exam\?t=/)
	})

	it("returns 500 without minting when no absolute base URL can be derived", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(user)
		vi.mocked(examDb.getSessionByKeyId).mockResolvedValue(null)
		const res = await post(examRoutes({} as Env), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		expect(res.status).toBe(500)
		expect(((await res.json()) as { code: string }).code).toBe("EXAM_NOT_CONFIGURED")
		expect(vi.mocked(startSession)).not.toHaveBeenCalled()
	})

	it("resumes an in_progress session with a fresh link, without a new draw", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(user)
		vi.mocked(examDb.getSessionByKeyId).mockResolvedValue({ ...okSession } as never)
		const res = await post(botApp(), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		const body = (await res.json()) as { data: { status: string; examUrl: string } }
		expect(body.data.status).toBe("eligible")
		expect(vi.mocked(examDb.reissueToken)).toHaveBeenCalled()
		expect(vi.mocked(startSession)).not.toHaveBeenCalled()
	})

	it("reports a submitted session as already_attempted without a link", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(user)
		vi.mocked(examDb.getSessionByKeyId).mockResolvedValue({
			...okSession,
			state: "failed",
			score: 12,
			submittedAt: 123,
		} as never)
		const res = await post(botApp(), "/exam/bot/start", { keyId: KEY, discordId: "d1" })
		const body = (await res.json()) as {
			data: { status: string; attempt: { state: string; score: number } }
		}
		expect(body.data.status).toBe("already_attempted")
		expect(body.data.attempt).toEqual({ state: "failed", score: 12, submittedAt: 123 })
	})
})

describe("GET /exam/bot/applicants", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		expect((await get(botApp(), "/exam/bot/applicants")).status).toBe(401)
	})

	it("returns the applicant list", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(examDb.listApplicants).mockResolvedValue([{ applicantId: 1 }] as never)
		const res = await get(botApp(), "/exam/bot/applicants?includeBelowCutoff=true")
		expect(vi.mocked(examDb.listApplicants)).toHaveBeenCalledWith(expect.anything(), true)
		expect((await res.json()) as unknown).toEqual({
			success: true,
			data: { applicants: [{ applicantId: 1 }] },
		})
	})
})

describe("POST /exam/bot/applicants/:id/decision", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await post(botApp(), "/exam/bot/applicants/5/decision", {
			decision: "approve",
			deciderDiscordId: "admin1",
		})
		expect(res.status).toBe(401)
	})

	it("returns 404 when no decidable session was updated", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(examDb.recordDecision).mockResolvedValue(false)
		const res = await post(botApp(), "/exam/bot/applicants/5/decision", {
			decision: "reject",
			deciderDiscordId: "admin1",
		})
		expect(res.status).toBe(404)
	})

	it("records a valid decision", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(examDb.recordDecision).mockResolvedValue(true)
		const res = await post(botApp(), "/exam/bot/applicants/5/decision", {
			decision: "approve",
			deciderDiscordId: "admin1",
		})
		expect(res.status).toBe(200)
		expect(vi.mocked(examDb.recordDecision)).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"approve",
			"admin1"
		)
	})
})

const verdictKey: AnswerKey = {
	parts: [
		{ id: "verdict", points: { no: 3, seal: -1 }, overSeal: "seal" },
		{ id: "reason", points: { "flaw-a": 2, "flaw-b": 0 } },
	],
}

function sessionQuestion(overrides: Record<string, unknown> = {}) {
	return {
		questionId: 1,
		position: 0,
		type: "timing",
		category: "seal-or-not",
		prompt: "Is this seal-worthy?",
		assets: { clip: { ttml: "<tt/>" } },
		choices: [{ id: "no", label: "No" }],
		answerKey: verdictKey,
		weight: 1,
		steps: null,
		answer: null,
		awardedPoints: null,
		maxPoints: null,
		...overrides,
	}
}

describe("GET /exam/session", () => {
	it("returns 401 EXAM_TOKEN_INVALID when the token is missing", async () => {
		const res = await get(spaApp(), "/exam/session", false)
		expect(res.status).toBe(401)
		expect(((await res.json()) as { code: string }).code).toBe("EXAM_TOKEN_INVALID")
	})

	it("maps an expired token to 410", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: false, reason: "expired" })
		const res = await get(spaApp(), "/exam/session?t=x", false)
		expect(res.status).toBe(410)
		expect(((await res.json()) as { code: string }).code).toBe("EXAM_TOKEN_EXPIRED")
	})

	it("maps a consumed token to 409 already-submitted", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: false, reason: "submitted" })
		const res = await get(spaApp(), "/exam/session?t=x", false)
		expect(res.status).toBe(409)
		expect(((await res.json()) as { code: string }).code).toBe("EXAM_ALREADY_SUBMITTED")
	})

	it("returns key-free questions, saved answers, and the candidate name", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({
			ok: true,
			session: okSession as never,
		})
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([
			sessionQuestion(),
			sessionQuestion({ questionId: 2, position: 1, answer: { verdict: "no" } }),
		] as never)
		const res = await get(spaApp(), "/exam/session?t=x", false)
		expect(res.status).toBe(200)
		const raw = await res.text()
		expect(raw).not.toContain("answerKey")
		expect(raw).not.toContain("flaw-a")
		const body = JSON.parse(raw) as {
			data: {
				candidate: { displayName: string }
				questions: { id: number }[]
				savedAnswers: Record<string, unknown>
				timeLimitSec: number
			}
		}
		expect(body.data.candidate.displayName).toBe("test_candidate")
		expect(body.data.questions.map((q) => q.id)).toEqual([1, 2])
		expect(body.data.savedAnswers).toEqual({ "2": { verdict: "no" } })
		expect(body.data.timeLimitSec).toBeGreaterThan(0)
	})

	it("surfaces examStartedAt so the client can resume the countdown", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({
			ok: true,
			session: { ...okSession, examStartedAt: 1700 } as never,
		})
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([sessionQuestion()] as never)
		const res = await get(spaApp(), "/exam/session?t=x", false)
		const body = (await res.json()) as { data: { examStartedAt: number | null } }
		expect(body.data.examStartedAt).toBe(1700)
	})
})

describe("POST /exam/begin", () => {
	it("stamps the exam clock and returns it for a valid token", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({
			ok: true,
			session: okSession as never,
		})
		vi.mocked(examDb.markExamStarted).mockResolvedValue(1700)
		const res = await post(spaApp(), "/exam/begin", { t: "x" }, false)
		expect(res.status).toBe(200)
		expect(vi.mocked(examDb.markExamStarted)).toHaveBeenCalledWith(expect.anything(), 5)
		expect(((await res.json()) as { data: { examStartedAt: number } }).data.examStartedAt).toBe(
			1700
		)
	})

	it("rejects an invalid token without stamping", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: false, reason: "invalid" })
		const res = await post(spaApp(), "/exam/begin", { t: "x" }, false)
		expect(res.status).toBe(401)
		expect(vi.mocked(examDb.markExamStarted)).not.toHaveBeenCalled()
	})
})

describe("POST /exam/answer", () => {
	it("autosaves an answer for a valid token", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({
			ok: true,
			session: okSession as never,
		})
		const res = await post(
			spaApp(),
			"/exam/answer",
			{ t: "x", questionId: 1, answer: { verdict: "no" } },
			false
		)
		expect(res.status).toBe(200)
		expect(vi.mocked(examDb.saveAnswer)).toHaveBeenCalledWith(expect.anything(), 5, 1, {
			verdict: "no",
		})
	})

	it("rejects an invalid token", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: false, reason: "invalid" })
		const res = await post(spaApp(), "/exam/answer", { t: "x", questionId: 1, answer: {} }, false)
		expect(res.status).toBe(401)
		expect(vi.mocked(examDb.saveAnswer)).not.toHaveBeenCalled()
	})

	describe("one-shot capstone", () => {
		const capstoneKey: AnswerKey = {
			parts: [
				{ id: "queue", points: { reject: 3, seal: -3 }, overSeal: "seal" },
				{ id: "dm", points: { hold: 3, cave: -3, rude: -1 }, overSeal: "cave" },
			],
		}
		function capstone(answer: Record<string, string> | null) {
			return { category: "capstone", answerKey: capstoneKey, answer } as never
		}
		function commit(answer: Record<string, string>) {
			vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: true, session: okSession as never })
			return post(spaApp(), "/exam/answer", { t: "x", questionId: 9, answer }, false)
		}

		it("commits a correct beat and reports the story is not over", async () => {
			vi.mocked(examDb.getSessionQuestion).mockResolvedValue(capstone({}))
			const res = await commit({ queue: "reject" })
			expect(res.status).toBe(200)
			expect(((await res.json()) as { data: { terminated: boolean } }).data.terminated).toBe(false)
			expect(vi.mocked(examDb.saveAnswer)).toHaveBeenCalledWith(expect.anything(), 5, 9, { queue: "reject" })
		})

		it("commits a wrong beat and reports the story terminated", async () => {
			vi.mocked(examDb.getSessionQuestion).mockResolvedValue(capstone({ queue: "reject" }))
			const res = await commit({ queue: "reject", dm: "cave" })
			expect(res.status).toBe(200)
			expect(((await res.json()) as { data: { terminated: boolean } }).data.terminated).toBe(true)
		})

		it("rejects changing an already-committed beat", async () => {
			vi.mocked(examDb.getSessionQuestion).mockResolvedValue(capstone({ queue: "reject" }))
			const res = await commit({ queue: "seal" })
			expect(res.status).toBe(409)
			expect(((await res.json()) as { code: string }).code).toBe("EXAM_ANSWER_LOCKED")
			expect(vi.mocked(examDb.saveAnswer)).not.toHaveBeenCalled()
		})

		it("rejects a new commit once the story has terminated", async () => {
			vi.mocked(examDb.getSessionQuestion).mockResolvedValue(capstone({ queue: "reject", dm: "cave" }))
			const res = await commit({ queue: "reject", dm: "cave", council: "hold" })
			expect(res.status).toBe(409)
			expect(vi.mocked(examDb.saveAnswer)).not.toHaveBeenCalled()
		})

		it("is idempotent: re-sending the same terminated answer is accepted", async () => {
			vi.mocked(examDb.getSessionQuestion).mockResolvedValue(capstone({ queue: "reject", dm: "cave" }))
			const res = await commit({ queue: "reject", dm: "cave" })
			expect(res.status).toBe(200)
		})
	})
})

describe("POST /exam/submit", () => {
	beforeEach(() => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({
			ok: true,
			session: okSession as never,
		})
	})

	it("grades a passing exam to pending_review and never reveals the score", async () => {
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([sessionQuestion()] as never)
		const res = await post(
			spaApp(),
			"/exam/submit",
			{ t: "x", answers: { "1": { verdict: "no", reason: "flaw-a" } } },
			false
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { state: "submitted" } })
		expect(vi.mocked(examDb.recordGrade)).toHaveBeenCalledWith(
			expect.anything(),
			5,
			expect.objectContaining({ state: "pending_review", score: 5, maxScore: 5 })
		)
	})

	it("grades a failing exam to failed", async () => {
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([sessionQuestion()] as never)
		await post(spaApp(), "/exam/submit", { t: "x", answers: { "1": { verdict: "seal" } } }, false)
		expect(vi.mocked(examDb.recordGrade)).toHaveBeenCalledWith(
			expect.anything(),
			5,
			expect.objectContaining({ state: "failed" })
		)
	})

	it("grades the capstone from the stored answer, ignoring a forged client override", async () => {
		const capstoneKey: AnswerKey = {
			parts: [{ id: "queue", points: { reject: 3, seal: -3 }, overSeal: "seal" }],
		}
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([
			sessionQuestion({
				questionId: 9,
				category: "capstone",
				answerKey: capstoneKey,
				answer: { queue: "seal" },
			}),
		] as never)
		await post(spaApp(), "/exam/submit", { t: "x", answers: { "9": { queue: "reject" } } }, false)
		expect(vi.mocked(examDb.recordGrade)).toHaveBeenCalledWith(
			expect.anything(),
			5,
			expect.objectContaining({ state: "failed", score: 0 })
		)
	})

	it("rejects a consumed token", async () => {
		vi.mocked(examDb.resolveExamSession).mockResolvedValue({ ok: false, reason: "submitted" })
		const res = await post(spaApp(), "/exam/submit", { t: "x", answers: {} }, false)
		expect(res.status).toBe(409)
		expect(vi.mocked(examDb.recordGrade)).not.toHaveBeenCalled()
	})
})

describe("POST /exam/admin/questions", () => {
	const question = {
		id: 1,
		type: "timing",
		category: "seal-or-not",
		prompt: "p",
		answerKey: { parts: [{ id: "verdict", points: { no: 3 } }] },
		weight: 1,
	}

	it("rejects a bad admin secret with 401", async () => {
		vi.mocked(isAuthorizedAdmin).mockReturnValue(false)
		const res = await post(spaApp(), "/exam/admin/questions", { questions: [question] })
		expect(res.status).toBe(401)
		expect(vi.mocked(examDb.upsertQuestions)).not.toHaveBeenCalled()
	})

	it("upserts questions for a valid admin secret", async () => {
		vi.mocked(isAuthorizedAdmin).mockReturnValue(true)
		vi.mocked(examDb.upsertQuestions).mockResolvedValue(1)
		const res = await post(spaApp(), "/exam/admin/questions", { questions: [question] })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { upserted: 1 } })
	})
})

describe("dev routes", () => {
	it("404 when the dev flag is off", async () => {
		const start = await post(spaApp({ EXAM_DEV_ENABLED: false }), "/exam/dev/start", {}, false)
		expect(start.status).toBe(404)
		const result = await get(
			spaApp({ EXAM_DEV_ENABLED: false }),
			"/exam/dev/result?sessionId=1",
			false
		)
		expect(result.status).toBe(404)
	})

	it("mints a dev session with a token when the flag is on", async () => {
		vi.mocked(startSession).mockResolvedValue({ id: 42 } as never)
		const res = await post(
			spaApp({ EXAM_DEV_ENABLED: true }),
			"/exam/dev/start",
			{ seed: 3 },
			false
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			data: { sessionId: number; token: string; examUrl: string }
		}
		expect(body.data.sessionId).toBe(42)
		expect(body.data.token).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(body.data.examUrl).toContain("?t=")
	})

	it("GET /dev/start 404s when the dev flag is off", async () => {
		const res = await get(spaApp({ EXAM_DEV_ENABLED: false }), "/exam/dev/start", false)
		expect(res.status).toBe(404)
	})

	it("GET /dev/start redirects into the exam when the flag is on", async () => {
		const res = await get(spaApp({ EXAM_DEV_ENABLED: true }), "/exam/dev/start", false)
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain("/exam?t=")
	})

	it("GET /dev/start?only draws just that category", async () => {
		vi.mocked(loadDrawableBank).mockResolvedValue([
			{ id: 1, category: "capstone" },
			{ id: 2, category: "seal-or-not" },
		] as never)
		let captured: number[] = []
		vi.mocked(startSession).mockImplementation((_env, _s, ids) => {
			captured = ids as number[]
			return Promise.resolve({ id: 9 } as never)
		})
		const res = await get(
			spaApp({ EXAM_DEV_ENABLED: true }),
			"/exam/dev/start?only=capstone",
			false
		)
		expect(res.status).toBe(302)
		expect(captured).toEqual([1])
	})

	it("exposes the graded result including the hidden score", async () => {
		vi.mocked(examDb.getSessionById).mockResolvedValue({
			id: 1,
			state: "pending_review",
			score: 5,
			maxScore: 5,
			cutoff: 4.25,
			submittedAt: 100,
			seed: 3,
			isDev: true,
		} as never)
		vi.mocked(examDb.getSessionQuestions).mockResolvedValue([
			sessionQuestion({ awardedPoints: 5, maxPoints: 5 }),
		] as never)
		const res = await get(spaApp({ EXAM_DEV_ENABLED: true }), "/exam/dev/result?sessionId=1", false)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			data: { session: { score: number }; breakdown: { section: string; score: number }[] }
		}
		expect(body.data.session.score).toBe(5)
		expect(body.data.breakdown).toEqual([{ section: "seal-or-not", score: 5, max: 5 }])
	})
})
