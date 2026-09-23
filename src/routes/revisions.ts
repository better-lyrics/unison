import { config } from "@/config"
import { getUserByKeyId } from "@/db/users"
import {
	type DecisionResult,
	type RevisionInput,
	type SaveResult,
	approveRevision,
	diffRevisions,
	getRevisionDetail,
	listPendingCards,
	listRevisions,
	previewRevision,
	rejectRevision,
	revertToRevision,
	saveRevision,
	withdrawPending,
} from "@/services/lyric-revisions"
import type { Env, LyricsFormat } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, type SubmissionErrorBody, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"

const EDIT_NOT_OWNER_HINT = "You can only edit lyrics you submitted yourself."
const DAILY_LIMIT_HINT =
	"You've reached today's edit limit for this lyric or your account. Try again tomorrow."

function parseId(raw: string | undefined): number | null {
	const id = Number(raw)
	return Number.isInteger(id) && id > 0 ? id : null
}

const isLyricsFormat = (value: unknown): value is LyricsFormat =>
	value === "ttml" || value === "lrc" || value === "plain"

const isOptionalText = (value: unknown): value is string | null | undefined =>
	value === undefined || value === null || typeof value === "string"

function parseRevisionBody(body: Record<string, unknown>): RevisionInput | null {
	const { lyrics, format, language, isrc } = body
	if (typeof lyrics !== "string" || lyrics.length === 0) return null
	if (!isLyricsFormat(format) || !isOptionalText(language) || !isOptionalText(isrc)) return null
	return { lyrics, format, language, isrc }
}

type Failure = { status: number; body: SubmissionErrorBody }

function saveFailure(result: Exclude<SaveResult, { ok: true }>): Failure {
	switch (result.reason) {
		case "not_found":
			return { status: 404, body: buildError(ErrorCode.NOT_FOUND) }
		case "not_owner":
			return { status: 403, body: buildError(ErrorCode.NOT_OWNER, { hint: EDIT_NOT_OWNER_HINT }) }
		case "rate_limited":
			return { status: 429, body: buildError(ErrorCode.RATE_LIMITED, { hint: DAILY_LIMIT_HINT }) }
		case "no_changes":
			return { status: 409, body: buildError(ErrorCode.NO_CHANGES) }
		case "invalid":
			return {
				status: 400,
				body: buildError(result.code, result.hint ? { hint: result.hint } : undefined),
			}
	}
}

const DECISION_ERROR: Record<
	Exclude<DecisionResult, { ok: true }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	not_committee: { status: 403, code: ErrorCode.NOT_COMMITTEE },
	not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	already_decided: { status: 409, code: ErrorCode.ALREADY_DECIDED },
	stale: { status: 409, code: ErrorCode.STALE },
}

export const revisionRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get("/:id/revisions", async ({ params, env, status }) => {
			const id = parseId(params.id)
			if (id === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const revisions = await listRevisions(env, id)
			if (!revisions) return status(404, buildError(ErrorCode.NOT_FOUND))
			return { success: true, data: { revisions } }
		})
		.get("/:id/revisions/:revId", async ({ params, env, status }) => {
			const id = parseId(params.id)
			const revId = parseId(params.revId)
			if (id === null || revId === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const revision = await getRevisionDetail(env, id, revId)
			if (!revision) return status(404, buildError(ErrorCode.NOT_FOUND))
			return { success: true, data: revision }
		})
		.get(
			"/:id/revisions/:revId/diff",
			async ({ params, query, env, status }) => {
				const id = parseId(params.id)
				const revId = parseId(params.revId)
				const against = query.against === undefined ? undefined : parseId(query.against)
				if (id === null || revId === null || against === null) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}
				const diff = await diffRevisions(env, id, revId, against ?? null)
				if (!diff) return status(404, buildError(ErrorCode.NOT_FOUND))
				return { success: true, data: diff }
			},
			{ query: t.Object({ against: t.Optional(t.String()) }) }
		)
		.use(eitherAuth)
		.post("/:id/revisions/preview", async ({ params, env, userId, keyId, body, status }) => {
			const id = parseId(params.id)
			if (id === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const { success } = await env.RATE_LIMITER.limit({
				key: `revision-preview:${keyId}`,
				maxRequests: config.revisions.preview.maxRequests,
				windowSeconds: config.revisions.preview.windowSeconds,
			})
			if (!success) return status(429, buildError(ErrorCode.RATE_LIMITED))
			const input = parseRevisionBody(body)
			if (!input) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			const result = await previewRevision(env, id, userId, input)
			if (!result.ok) {
				const failure = saveFailure(result)
				return status(failure.status, failure.body)
			}
			return { success: true, data: result.preview }
		})
		.post("/:id/revisions", async ({ params, env, userId, body, status }) => {
			const id = parseId(params.id)
			if (id === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const input = parseRevisionBody(body)
			if (!input) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			const result = await saveRevision(env, id, userId, input)
			if (!result.ok) {
				const failure = saveFailure(result)
				return status(failure.status, failure.body)
			}
			return { success: true, data: { revision: result.revision } }
		})
		.post("/:id/revisions/:revId/revert", async ({ params, env, userId, status }) => {
			const id = parseId(params.id)
			const revId = parseId(params.revId)
			if (id === null || revId === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const result = await revertToRevision(env, id, userId, revId)
			if (!result.ok) {
				const failure = saveFailure(result)
				return status(failure.status, failure.body)
			}
			return { success: true, data: { revision: result.revision } }
		})
		.delete("/:id/revisions/pending", async ({ params, env, userId, status }) => {
			const id = parseId(params.id)
			if (id === null) return status(400, buildError(ErrorCode.INVALID_ID))
			const result = await withdrawPending(env, id, userId)
			if (!result.ok) {
				const failure = saveFailure(result)
				return status(failure.status, failure.body)
			}
			return { success: true, data: { revision: result.revision } }
		})

export const revisionBotRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get("/revisions/pending/bot", async ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			return { success: true, data: await listPendingCards(env) }
		})
		.post(
			"/:id/revisions/:revId/approve/bot",
			async ({ params, env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = parseId(params.id)
				const revId = parseId(params.revId)
				if (id === null || revId === null) return status(400, buildError(ErrorCode.INVALID_ID))
				const reviewer = await getUserByKeyId(env, body.keyId)
				if (!reviewer) return status(403, buildError(ErrorCode.NOT_COMMITTEE))
				const result = await approveRevision(env, id, revId, reviewer.id)
				if (!result.ok) {
					const mapped = DECISION_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				return { success: true, data: { revision: result.revision } }
			},
			{ body: t.Object({ keyId: t.String() }) }
		)
		.post(
			"/:id/revisions/:revId/reject/bot",
			async ({ params, env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = parseId(params.id)
				const revId = parseId(params.revId)
				if (id === null || revId === null) return status(400, buildError(ErrorCode.INVALID_ID))
				const reviewer = await getUserByKeyId(env, body.keyId)
				if (!reviewer) return status(403, buildError(ErrorCode.NOT_COMMITTEE))
				const note = body.note?.trim() || null
				const result = await rejectRevision(env, id, revId, reviewer.id, note)
				if (!result.ok) {
					const mapped = DECISION_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				return { success: true, data: { revision: result.revision } }
			},
			{
				body: t.Object({
					keyId: t.String(),
					note: t.Optional(t.String({ maxLength: config.validation.report.maxDetailsLength })),
				}),
			}
		)
