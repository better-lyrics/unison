import { config } from "@/config"
import { type BoostResult, type RevokeResult, createBoost, getQuota, revokeBoost } from "@/db/boost"
import { isCommittee } from "@/db/committee"
import { getLyricsById } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { castVote, removeVote } from "@/db/votes"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"

const VALID_REPORT_REASONS = ["wrong_song", "bad_sync", "offensive", "spam", "other"] as const
type ReportReason = (typeof VALID_REPORT_REASONS)[number]

const BOOST_ERROR: Record<
	Extract<BoostResult, { ok: false }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	not_committee: { status: 403, code: ErrorCode.NOT_COMMITTEE },
	lyric_not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	self: { status: 400, code: ErrorCode.BOOST_SELF },
	target_committee: { status: 400, code: ErrorCode.BOOST_TARGET_COMMITTEE },
	over_quota: { status: 429, code: ErrorCode.BOOST_QUOTA_EXCEEDED },
	already_boosted: { status: 409, code: ErrorCode.BOOST_ALREADY_ACTIVE },
}

const REVOKE_ERROR: Record<
	Extract<RevokeResult, { ok: false }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	forbidden: { status: 403, code: ErrorCode.BOOST_NOT_OWNER },
}

function isReportReason(value: unknown): value is ReportReason {
	return typeof value === "string" && (VALID_REPORT_REASONS as readonly string[]).includes(value)
}

// Dual-auth (bearer or signed envelope) presents two different raw body shapes
// before eitherAuth normalizes them, so route-level body schemas can't run here.
// These parsers stand in for that declarative validation.
function parseVoteBody(body: unknown): { vote: 1 | -1 } | null {
	if (!body || typeof body !== "object") return null
	const v = (body as { vote?: unknown }).vote
	if (v !== 1 && v !== -1) return null
	return { vote: v }
}

function parseReportBody(
	body: unknown
): { reason: ReportReason; details?: string } | "invalid-reason" | "details-too-long" | null {
	if (!body || typeof body !== "object") return null
	const reason = (body as { reason?: unknown }).reason
	if (!isReportReason(reason)) return "invalid-reason"
	const rawDetails = (body as { details?: unknown }).details
	const details = typeof rawDetails === "string" ? rawDetails : undefined
	if (details !== undefined && details.length > config.validation.report.maxDetailsLength) {
		return "details-too-long"
	}
	return details !== undefined ? { reason, details } : { reason }
}

export const voteRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.use(eitherAuth)
		.post(
			"/:id/vote",
			async ({ params, env, userId, keyId, body, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const { success } = await env.RATE_LIMITER.limit({ key: keyId })
				if (!success) {
					return status(429, buildError(ErrorCode.RATE_LIMITED))
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}

				const parsed = parseVoteBody(body)
				if (!parsed) {
					return status(400, buildError(ErrorCode.INVALID_VOTE))
				}

				const result = await castVote(env, id, userId, parsed.vote)

				return status(result.success ? 200 : 409, {
					success: result.success,
					data: { message: result.message },
				})
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.delete(
			"/:id/vote",
			async ({ params, env, userId, keyId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const { success } = await env.RATE_LIMITER.limit({ key: keyId })
				if (!success) {
					return status(429, buildError(ErrorCode.RATE_LIMITED))
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}

				const result = await removeVote(env, id, userId)

				return status(result.success ? 200 : 404, {
					success: result.success,
					data: { message: result.message },
				})
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.post(
			"/:id/report",
			async ({ params, env, userId, body, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}

				const parsed = parseReportBody(body)
				if (parsed === null || parsed === "invalid-reason") {
					return status(400, buildError(ErrorCode.INVALID_REPORT_REASON))
				}
				if (parsed === "details-too-long") {
					return status(400, buildError(ErrorCode.REPORT_DETAILS_TOO_LONG))
				}

				const result = await submitReport(env, id, userId, parsed)

				return status(result.success ? 201 : 409, {
					success: result.success,
					data: { message: result.message },
				})
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.post(
			"/:id/boost",
			async ({ params, env, userId, keyId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				const { success } = await env.RATE_LIMITER.limit({ key: keyId })
				if (!success) {
					return status(429, buildError(ErrorCode.RATE_LIMITED))
				}

				const result = await createBoost(env, userId, id)
				if (!result.ok) {
					const mapped = BOOST_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}

				return { success: true, quota: result.quota }
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.delete(
			"/:id/boost",
			async ({ params, env, userId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}

				if (!(await isCommittee(env, userId))) {
					return status(403, buildError(ErrorCode.NOT_COMMITTEE))
				}

				const result = await revokeBoost(env, userId, id)
				if (!result.ok) {
					const mapped = REVOKE_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}

				return { success: true }
			},
			{ params: t.Object({ id: t.String() }) }
		)
		.get("/boost/quota", async ({ env, userId, status }) => {
			if (!(await isCommittee(env, userId))) {
				return status(403, buildError(ErrorCode.NOT_COMMITTEE))
			}

			return { success: true, quota: await getQuota(env, userId) }
		})
