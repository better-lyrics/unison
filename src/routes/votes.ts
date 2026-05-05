import { Elysia, t } from "elysia"
import { config } from "@/config"
import { getLyricsById } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { castVote, removeVote } from "@/db/votes"
import type { Env } from "@/types"
import { signedRequest } from "@/utils/auth"

export const voteRoutes = (env: Env) =>
	new Elysia({ prefix: "/lyrics" })
		.decorate("env", env)
		.use(signedRequest)
		.post(
			"/:id/vote",
			async ({ params, env, userId, signedPayload, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, { success: false, error: "Invalid ID" })
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, { success: false, error: "Lyrics not found" })
				}

				const vote = signedPayload.vote
				if (vote !== 1 && vote !== -1) {
					return status(400, { success: false, error: "Vote must be 1 or -1" })
				}

				const result = await castVote(env, id, userId, vote)

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
					return status(400, { success: false, error: "Invalid ID" })
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, { success: false, error: "Lyrics not found" })
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
			async ({ params, env, userId, signedPayload, status }) => {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					return status(400, { success: false, error: "Invalid ID" })
				}

				const lyrics = await getLyricsById(env, id)
				if (!lyrics) {
					return status(404, { success: false, error: "Lyrics not found" })
				}

				const reason = signedPayload.reason
				const validReasons = ["wrong_song", "bad_sync", "offensive", "spam", "other"]
				if (typeof reason !== "string" || !validReasons.includes(reason)) {
					return status(400, { success: false, error: "Invalid report reason" })
				}

				const details =
					typeof signedPayload.details === "string" ? signedPayload.details : undefined
				if (details && details.length > config.validation.report.maxDetailsLength) {
					return status(400, { success: false, error: "Report details too long" })
				}

				const result = await submitReport(env, id, userId, {
					reason: reason as "wrong_song" | "bad_sync" | "offensive" | "spam" | "other",
					details,
				})

				return status(result.success ? 201 : 409, {
					success: result.success,
					data: { message: result.message },
				})
			},
			{ params: t.Object({ id: t.String() }) }
		)
