import { getLyricsById } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { castVote, removeVote } from "@/db/votes"
import { IdParamSchema, ReportSchema, VoteSchema } from "@/schemas"
import type { ApiResponse, Env } from "@/types"
import { createSignedRequestMiddleware } from "@/utils/auth"
import { type } from "arktype"
import { Hono } from "hono"

type Variables = { keyId: string; userId: number; signedPayload: Record<string, unknown> }

const votes = new Hono<{ Bindings: Env; Variables: Variables }>()

votes.post("/:id/vote", createSignedRequestMiddleware(), async (c) => {
	const paramParsed = IdParamSchema({ id: c.req.param("id") })
	if (paramParsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const lyrics = await getLyricsById(c.env, paramParsed.id)
	if (!lyrics) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	const payload = c.get("signedPayload")
	const parsed = VoteSchema(payload)
	if (parsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: parsed.summary }, 400)
	}

	const userId = c.get("userId")
	const result = await castVote(c.env, paramParsed.id, userId, parsed.vote)

	return c.json<ApiResponse<{ message: string }>>(
		{ success: result.success, data: { message: result.message } },
		result.success ? 200 : 409
	)
})

votes.delete("/:id/vote", createSignedRequestMiddleware(), async (c) => {
	const paramParsed = IdParamSchema({ id: c.req.param("id") })
	if (paramParsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const lyrics = await getLyricsById(c.env, paramParsed.id)
	if (!lyrics) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	const userId = c.get("userId")
	const result = await removeVote(c.env, paramParsed.id, userId)

	return c.json<ApiResponse<{ message: string }>>(
		{ success: result.success, data: { message: result.message } },
		result.success ? 200 : 404
	)
})

votes.post("/:id/report", createSignedRequestMiddleware(), async (c) => {
	const paramParsed = IdParamSchema({ id: c.req.param("id") })
	if (paramParsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const lyrics = await getLyricsById(c.env, paramParsed.id)
	if (!lyrics) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	const payload = c.get("signedPayload")
	const parsed = ReportSchema(payload)
	if (parsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: parsed.summary }, 400)
	}

	const userId = c.get("userId")
	const result = await submitReport(c.env, paramParsed.id, userId, {
		reason: parsed.reason,
		details: parsed.details,
	})

	return c.json<ApiResponse<{ message: string }>>(
		{ success: result.success, data: { message: result.message } },
		result.success ? 201 : 409
	)
})

export default votes
