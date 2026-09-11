import type { Env } from "@/types"
import { hashExamToken } from "@/utils/exam-token"
import type { AnswerKey, AnswerValue, ExamQuestionType } from "@/utils/exam-types"
import { getByKeyId } from "./discordLinks"
import { resolveDisplayName } from "./users"

function parseJsonb<T>(value: unknown): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : (value as T)
}

export type ExamSessionState = "in_progress" | "pending_review" | "failed" | "approved" | "rejected"

export interface ExamSession {
	id: number
	keyId: string
	discordId: string | null
	state: ExamSessionState
	tokenHash: string | null
	score: number | null
	maxScore: number | null
	cutoff: number | null
	seed: number
	isDev: boolean
	startedAt: number
	examStartedAt: number | null
	expiresAt: number
	submittedAt: number | null
	decidedAt: number | null
	decidedByDiscordId: string | null
}

interface ExamSessionRow {
	id: number | string
	key_id: string
	discord_id: string | null
	state: ExamSessionState
	token_hash: string | null
	score: number | null
	max_score: number | null
	cutoff: number | null
	seed: number | string
	is_dev: boolean
	started_at: number | string
	exam_started_at: number | string | null
	expires_at: number | string
	submitted_at: number | string | null
	decided_at: number | string | null
	decided_by_discord_id: string | null
}

function toSession(row: ExamSessionRow): ExamSession {
	return {
		id: Number(row.id),
		keyId: row.key_id,
		discordId: row.discord_id,
		state: row.state,
		tokenHash: row.token_hash,
		score: row.score === null ? null : Number(row.score),
		maxScore: row.max_score === null ? null : Number(row.max_score),
		cutoff: row.cutoff === null ? null : Number(row.cutoff),
		seed: Number(row.seed),
		isDev: row.is_dev,
		startedAt: Number(row.started_at),
		examStartedAt: row.exam_started_at === null ? null : Number(row.exam_started_at),
		expiresAt: Number(row.expires_at),
		submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
		decidedAt: row.decided_at === null ? null : Number(row.decided_at),
		decidedByDiscordId: row.decided_by_discord_id,
	}
}

const SESSION_COLS =
	"id, key_id, discord_id, state, token_hash, score, max_score, cutoff, seed, is_dev, started_at, exam_started_at, expires_at, submitted_at, decided_at, decided_by_discord_id"

// ---- bank ----

export interface DrawableBankQuestion {
	id: number
	category: string
}

export async function loadDrawableBank(env: Env): Promise<DrawableBankQuestion[]> {
	const res = await env.DB.prepare("SELECT id, category FROM exam_question WHERE active = TRUE")
		.bind()
		.all<{ id: number | string; category: string }>()
	return res.results.map((r) => ({ id: Number(r.id), category: r.category }))
}

export interface ExamQuestionInput {
	id: number
	type: ExamQuestionType
	category: string
	prompt: string
	assets?: unknown
	choices?: unknown
	answerKey: AnswerKey
	weight: number
	steps?: unknown
	active?: boolean
}

// Upsert bank rows by explicit id (the private JSON / admin payload owns ids).
// Questions are retired with active = false, never deleted, so session foreign
// keys stay valid.
export async function upsertQuestions(env: Env, questions: ExamQuestionInput[]): Promise<number> {
	if (questions.length === 0) return 0
	await env.DB.transaction(async (tx) => {
		for (const q of questions) {
			await tx
				.prepare(
					`INSERT INTO exam_question
						(id, type, category, prompt, assets, choices, answer_key, weight, steps, active, updated_at)
					VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
					ON CONFLICT (id) DO UPDATE SET
						type = EXCLUDED.type,
						category = EXCLUDED.category,
						prompt = EXCLUDED.prompt,
						assets = EXCLUDED.assets,
						choices = EXCLUDED.choices,
						answer_key = EXCLUDED.answer_key,
						weight = EXCLUDED.weight,
						steps = EXCLUDED.steps,
						active = EXCLUDED.active,
						updated_at = EXCLUDED.updated_at`
				)
				.bind(
					q.id,
					q.type,
					q.category,
					q.prompt,
					q.assets == null ? null : JSON.stringify(q.assets),
					q.choices == null ? null : JSON.stringify(q.choices),
					JSON.stringify(q.answerKey),
					q.weight,
					q.steps == null ? null : JSON.stringify(q.steps),
					q.active ?? true
				)
				.run()
		}
		await tx
			.prepare(
				"SELECT setval(pg_get_serial_sequence('exam_question', 'id'), (SELECT MAX(id) FROM exam_question))"
			)
			.bind()
			.first()
	})
	return questions.length
}

// ---- session lifecycle ----

export interface StartSessionParams {
	keyId: string
	discordId: string | null
	tokenHash: string | null
	seed: number
	expiresAt: number
	isDev: boolean
}

export async function startSession(
	env: Env,
	params: StartSessionParams,
	orderedQuestionIds: number[]
): Promise<ExamSession> {
	return env.DB.transaction(async (tx) => {
		const row = await tx
			.prepare(
				`INSERT INTO exam_session (key_id, discord_id, token_hash, seed, is_dev, expires_at)
				VALUES (?, ?, ?, ?, ?, ?) RETURNING ${SESSION_COLS}`
			)
			.bind(
				params.keyId,
				params.discordId,
				params.tokenHash,
				params.seed,
				params.isDev,
				params.expiresAt
			)
			.first<ExamSessionRow>()
		const session = toSession(row as ExamSessionRow)
		for (let i = 0; i < orderedQuestionIds.length; i++) {
			await tx
				.prepare(
					"INSERT INTO exam_session_question (session_id, question_id, position) VALUES (?, ?, ?)"
				)
				.bind(session.id, orderedQuestionIds[i], i)
				.run()
		}
		return session
	})
}

export async function getSessionByKeyId(env: Env, keyId: string): Promise<ExamSession | null> {
	const row = await env.DB.prepare(
		`SELECT ${SESSION_COLS} FROM exam_session WHERE key_id = ? AND is_dev = FALSE`
	)
		.bind(keyId)
		.first<ExamSessionRow>()
	return row ? toSession(row) : null
}

export async function getSessionByTokenHash(
	env: Env,
	tokenHash: string
): Promise<ExamSession | null> {
	const row = await env.DB.prepare(`SELECT ${SESSION_COLS} FROM exam_session WHERE token_hash = ?`)
		.bind(tokenHash)
		.first<ExamSessionRow>()
	return row ? toSession(row) : null
}

export type ResolveExamResult =
	| { ok: true; session: ExamSession }
	| { ok: false; reason: "invalid" | "expired" | "submitted" }

// The exam SPA's only auth. The single-use link stays valid across refreshes
// while the session is in_progress; the token is consumed by the state flip on
// submit, not by nulling the hash, so a post-submit reload reads as "submitted".
export async function resolveExamSession(env: Env, token: string): Promise<ResolveExamResult> {
	const session = await getSessionByTokenHash(env, await hashExamToken(token))
	if (!session) return { ok: false, reason: "invalid" }
	if (Math.floor(Date.now() / 1000) > session.expiresAt) return { ok: false, reason: "expired" }
	if (session.state !== "in_progress") return { ok: false, reason: "submitted" }
	return { ok: true, session }
}

// Resume: mint a fresh link for an in_progress session without granting a new
// draw. The prior token stops resolving.
export async function reissueToken(
	env: Env,
	sessionId: number,
	tokenHash: string,
	expiresAt: number
): Promise<void> {
	await env.DB.prepare("UPDATE exam_session SET token_hash = ?, expires_at = ? WHERE id = ?")
		.bind(tokenHash, expiresAt, sessionId)
		.run()
}

export async function getSessionById(env: Env, id: number): Promise<ExamSession | null> {
	const row = await env.DB.prepare(`SELECT ${SESSION_COLS} FROM exam_session WHERE id = ?`)
		.bind(id)
		.first<ExamSessionRow>()
	return row ? toSession(row) : null
}

export interface SessionQuestion {
	questionId: number
	position: number
	type: ExamQuestionType
	category: string
	prompt: string
	assets: unknown | null
	choices: unknown | null
	answerKey: AnswerKey
	weight: number
	steps: unknown | null
	answer: AnswerValue | null
	awardedPoints: number | null
	maxPoints: number | null
}

interface SessionQuestionRow {
	question_id: number | string
	position: number | string
	type: ExamQuestionType
	category: string
	prompt: string
	assets: unknown | null
	choices: unknown | null
	answer_key: unknown
	weight: number | string
	steps: unknown | null
	answer: unknown | null
	awarded_points: number | null
	max_points: number | null
}

export async function getSessionQuestions(env: Env, sessionId: number): Promise<SessionQuestion[]> {
	const res = await env.DB.prepare(
		`SELECT sq.question_id, sq.position, sq.answer, sq.awarded_points, sq.max_points,
			q.type, q.category, q.prompt, q.assets, q.choices, q.answer_key, q.weight, q.steps
		FROM exam_session_question sq
		JOIN exam_question q ON q.id = sq.question_id
		WHERE sq.session_id = ?
		ORDER BY sq.position ASC`
	)
		.bind(sessionId)
		.all<SessionQuestionRow>()
	return res.results.map((r) => ({
		questionId: Number(r.question_id),
		position: Number(r.position),
		type: r.type,
		category: r.category,
		prompt: r.prompt,
		assets: r.assets == null ? null : parseJsonb(r.assets),
		choices: r.choices == null ? null : parseJsonb(r.choices),
		answerKey: parseJsonb<AnswerKey>(r.answer_key),
		weight: Number(r.weight),
		steps: r.steps == null ? null : parseJsonb(r.steps),
		answer: r.answer == null ? null : parseJsonb<AnswerValue>(r.answer),
		awardedPoints: r.awarded_points === null ? null : Number(r.awarded_points),
		maxPoints: r.max_points === null ? null : Number(r.max_points),
	}))
}

// Retire (active = FALSE) any question absent from the given id set, so removing a
// question from the bank takes it out of future draws. Existing sessions keep their
// drawn rows; this flips the flag, never deletes.
export async function retireQuestionsExcept(env: Env, keepIds: number[]): Promise<void> {
	if (keepIds.length === 0) {
		await env.DB.prepare("UPDATE exam_question SET active = FALSE WHERE active = TRUE").run()
		return
	}
	const placeholders = keepIds.map(() => "?").join(", ")
	await env.DB.prepare(
		`UPDATE exam_question SET active = FALSE WHERE active = TRUE AND id NOT IN (${placeholders})`
	)
		.bind(...keepIds)
		.run()
}

// The council is Discord-gated, so the exam addresses the candidate by their Discord
// name (both the welcome and the roleplay @mention read this). Falls back to the
// Better Lyrics nickname when no link exists (e.g. dev sessions).
export async function resolveCandidateName(env: Env, keyId: string): Promise<string> {
	const link = await getByKeyId(env, keyId)
	return link?.discord_username ?? (await resolveDisplayName(env, keyId))
}

export async function getSessionQuestion(
	env: Env,
	sessionId: number,
	questionId: number
): Promise<SessionQuestion | null> {
	const r = await env.DB.prepare(
		`SELECT sq.question_id, sq.position, sq.answer, sq.awarded_points, sq.max_points,
			q.type, q.category, q.prompt, q.assets, q.choices, q.answer_key, q.weight, q.steps
		FROM exam_session_question sq
		JOIN exam_question q ON q.id = sq.question_id
		WHERE sq.session_id = ? AND sq.question_id = ?`
	)
		.bind(sessionId, questionId)
		.first<SessionQuestionRow>()
	if (!r) return null
	return {
		questionId: Number(r.question_id),
		position: Number(r.position),
		type: r.type,
		category: r.category,
		prompt: r.prompt,
		assets: r.assets == null ? null : parseJsonb(r.assets),
		choices: r.choices == null ? null : parseJsonb(r.choices),
		answerKey: parseJsonb<AnswerKey>(r.answer_key),
		weight: Number(r.weight),
		steps: r.steps == null ? null : parseJsonb(r.steps),
		answer: r.answer == null ? null : parseJsonb<AnswerValue>(r.answer),
		awardedPoints: r.awarded_points === null ? null : Number(r.awarded_points),
		maxPoints: r.max_points === null ? null : Number(r.max_points),
	}
}

// Stamp the exam clock on the first Begin and return it. Idempotent: COALESCE keeps
// the original start, so reopening the link resumes the same countdown instead of
// resetting it. Only stamps while in_progress.
export async function markExamStarted(env: Env, sessionId: number): Promise<number> {
	const now = Math.floor(Date.now() / 1000)
	const row = await env.DB.prepare(
		`UPDATE exam_session
		SET exam_started_at = COALESCE(exam_started_at, ?)
		WHERE id = ? AND state = 'in_progress'
		RETURNING exam_started_at`
	)
		.bind(now, sessionId)
		.first<{ exam_started_at: number | string }>()
	return row ? Number(row.exam_started_at) : now
}

export async function saveAnswer(
	env: Env,
	sessionId: number,
	questionId: number,
	answer: AnswerValue
): Promise<void> {
	await env.DB.prepare(
		"UPDATE exam_session_question SET answer = ?::jsonb WHERE session_id = ? AND question_id = ?"
	)
		.bind(JSON.stringify(answer), sessionId, questionId)
		.run()
}

export interface PerQuestionGrade {
	questionId: number
	awardedPoints: number
	maxPoints: number
}

// Persist the grade and consume the token. Flipping state off in_progress is the
// authority that makes the link single-use and lets a reload read as submitted.
export async function recordGrade(
	env: Env,
	sessionId: number,
	params: {
		state: Extract<ExamSessionState, "pending_review" | "failed">
		score: number
		maxScore: number
		cutoff: number
		submittedAt: number
		perQuestion: PerQuestionGrade[]
	}
): Promise<void> {
	await env.DB.transaction(async (tx) => {
		for (const q of params.perQuestion) {
			await tx
				.prepare(
					"UPDATE exam_session_question SET awarded_points = ?, max_points = ? WHERE session_id = ? AND question_id = ?"
				)
				.bind(q.awardedPoints, q.maxPoints, sessionId, q.questionId)
				.run()
		}
		await tx
			.prepare(
				`UPDATE exam_session
				SET state = ?, score = ?, max_score = ?, cutoff = ?, submitted_at = ?
				WHERE id = ?`
			)
			.bind(
				params.state,
				params.score,
				params.maxScore,
				params.cutoff,
				params.submittedAt,
				sessionId
			)
			.run()
	})
}

// ---- applicant review ----

export interface ApplicantArea {
	section: string
	score: number
	max: number
}

export interface Applicant {
	applicantId: number
	discordId: string | null
	keyId: string
	displayName: string
	score: number | null
	maxScore: number | null
	cutoff: number | null
	breakdown: ApplicantArea[]
	submittedAt: number | null
	state: ExamSessionState
}

export async function listApplicants(env: Env, includeBelowCutoff: boolean): Promise<Applicant[]> {
	const states = includeBelowCutoff ? ["pending_review", "failed"] : ["pending_review"]
	const res = await env.DB.prepare(
		`SELECT ${SESSION_COLS} FROM exam_session WHERE state = ANY(?) ORDER BY score DESC NULLS LAST`
	)
		.bind(states)
		.all<ExamSessionRow>()
	const sessions = res.results.map(toSession)
	if (sessions.length === 0) return []

	const breakdowns = await loadBreakdowns(
		env,
		sessions.map((s) => s.id)
	)

	const applicants: Applicant[] = []
	for (const s of sessions) {
		applicants.push({
			applicantId: s.id,
			discordId: s.discordId,
			keyId: s.keyId,
			displayName: await resolveDisplayName(env, s.keyId),
			score: s.score,
			maxScore: s.maxScore,
			cutoff: s.cutoff,
			breakdown: breakdowns.get(s.id) ?? [],
			submittedAt: s.submittedAt,
			state: s.state,
		})
	}
	return applicants
}

async function loadBreakdowns(
	env: Env,
	sessionIds: number[]
): Promise<Map<number, ApplicantArea[]>> {
	const res = await env.DB.prepare(
		`SELECT sq.session_id, q.category,
			COALESCE(SUM(sq.awarded_points), 0) AS score,
			COALESCE(SUM(sq.max_points), 0) AS max
		FROM exam_session_question sq
		JOIN exam_question q ON q.id = sq.question_id
		WHERE sq.session_id = ANY(?)
		GROUP BY sq.session_id, q.category`
	)
		.bind(sessionIds)
		.all<{
			session_id: number | string
			category: string
			score: number | string
			max: number | string
		}>()
	const map = new Map<number, ApplicantArea[]>()
	for (const r of res.results) {
		const id = Number(r.session_id)
		const areas = map.get(id) ?? []
		areas.push({ section: r.category, score: Number(r.score), max: Number(r.max) })
		map.set(id, areas)
	}
	return map
}

export async function recordDecision(
	env: Env,
	applicantId: number,
	decision: "approve" | "reject",
	deciderDiscordId: string
): Promise<boolean> {
	const state = decision === "approve" ? "approved" : "rejected"
	const now = Math.floor(Date.now() / 1000)
	const row = await env.DB.prepare(
		`UPDATE exam_session
		SET state = ?, decided_at = ?, decided_by_discord_id = ?
		WHERE id = ? AND state IN ('pending_review', 'failed')
		RETURNING id`
	)
		.bind(state, now, deciderDiscordId, applicantId)
		.first<{ id: number | string }>()
	return row !== null
}
