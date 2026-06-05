import { Elysia, t } from "elysia"
import { config } from "@/config"
import { getLyricsById } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { castVote, removeVote } from "@/db/votes"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { buildError, ErrorCode } from "@/utils/errors"

const VALID_REPORT_REASONS = ["wrong_song", "bad_sync", "offensive", "spam", "other"] as const
type ReportReason = (typeof VALID_REPORT_REASONS)[number]

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
			async ({ params, env, userId, body, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
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
			async ({ params, env, userId, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
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
