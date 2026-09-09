import {
	type QueueSort,
	type RejectResult,
	type UndoRejectResult,
	getSealCandidates,
	rejectLyric,
	undoRejection,
} from "@/db/rejections"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { decompress, isCompressed } from "@/utils/compression"
import { ErrorCode, buildError } from "@/utils/errors"
import { generatePetName } from "@/utils/petname"
import { ttmlSignals } from "@/utils/ttml-signals"
import { Elysia, t } from "elysia"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

const REJECT_ERROR: Record<
	Extract<RejectResult, { ok: false }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	not_committee: { status: 403, code: ErrorCode.NOT_COMMITTEE },
	lyric_not_found: { status: 404, code: ErrorCode.NOT_FOUND },
	already_rejected: { status: 409, code: ErrorCode.REJECT_ALREADY_ACTIVE },
}

const UNDO_ERROR: Record<
	Extract<UndoRejectResult, { ok: false }>["reason"],
	{ status: number; code: ErrorCode }
> = {
	not_committee: { status: 403, code: ErrorCode.NOT_COMMITTEE },
	not_found: { status: 404, code: ErrorCode.NOT_FOUND },
}

function parseLimit(raw: string | undefined): number {
	const n = Number(raw)
	if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT
	return Math.min(MAX_LIMIT, n)
}

// Signals are advisory: a corrupt payload must never break the queue.
async function signalsFor(content: string): Promise<string[]> {
	try {
		const ttml = isCompressed(content) ? await decompress(content) : content
		return ttmlSignals(ttml)
	} catch {
		return []
	}
}

export const reviewQueueBotRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.get(
			"/queue/bot",
			async ({ env, headers, query, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const limit = parseLimit(query.limit)
				const sort: QueueSort = query.sort === "most-voted" ? "most-voted" : "top-rated"
				const candidates = await getSealCandidates(env, { limit, sort })

				const data = await Promise.all(
					candidates.map(async (c) => {
						const base = {
							id: c.id,
							videoId: c.video_id,
							song: c.song,
							artist: c.artist,
							format: c.format,
							score: c.score,
							voteCount: c.vote_count,
							submitter: c.submitter_key_id
								? { displayName: c.submitter_nickname ?? generatePetName(c.submitter_key_id) }
								: null,
						}
						if (c.format !== "ttml") return base
						return { ...base, ttmlSignals: await signalsFor(c.lyrics) }
					})
				)

				return { success: true, data }
			},
			{ query: t.Object({ limit: t.Optional(t.String()), sort: t.Optional(t.String()) }) }
		)
		.post(
			"/:id/reject/bot",
			async ({ params, env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				const result = await rejectLyric(env, id, user.id, body.note)
				if (!result.ok) {
					const mapped = REJECT_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				return { success: true }
			},
			{
				params: t.Object({ id: t.String() }),
				body: t.Object({ keyId: t.String(), note: t.Optional(t.String()) }),
			}
		)
		.delete(
			"/:id/reject/bot",
			async ({ params, env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, buildError(ErrorCode.INVALID_ID))
				}
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				const result = await undoRejection(env, id, user.id)
				if (!result.ok) {
					const mapped = UNDO_ERROR[result.reason]
					return status(mapped.status, buildError(mapped.code))
				}
				return { success: true }
			},
			{ params: t.Object({ id: t.String() }), body: t.Object({ keyId: t.String() }) }
		)
