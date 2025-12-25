import { getLyricsById } from "@/db/lyrics"
import { submitReport } from "@/db/reports"
import { getOrCreateUser } from "@/db/users"
import { castVote, removeVote } from "@/db/votes"
import { IdParamSchema, ReportSchema, VoteSchema } from "@/schemas"
import type { ApiResponse, Env } from "@/types"
import { hashDeviceId } from "@/utils/hash"
import { type } from "arktype"
import { Hono } from "hono"

type Variables = { deviceHash: string; userId: number }

const votes = new Hono<{ Bindings: Env; Variables: Variables }>()

votes.use("*", async (c, next) => {
	const deviceId = c.req.header("x-device-id")
	if (!deviceId) {
		return c.json<ApiResponse>({ success: false, error: "Missing X-Device-ID header" }, 401)
	}
	const deviceHash = hashDeviceId(deviceId)
	const user = await getOrCreateUser(c.env, deviceHash)
	c.set("deviceHash", deviceHash)
	c.set("userId", user.id)
	await next()
})

votes.post("/:id/vote", async (c) => {
	const paramParsed = IdParamSchema({ id: c.req.param("id") })
	if (paramParsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const lyrics = await getLyricsById(c.env, paramParsed.id)
	if (!lyrics) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json<ApiResponse>({ success: false, error: "Invalid JSON" }, 400)
	}

	const parsed = VoteSchema(body)
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

votes.delete("/:id/vote", async (c) => {
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

votes.post("/:id/report", async (c) => {
	const paramParsed = IdParamSchema({ id: c.req.param("id") })
	if (paramParsed instanceof type.errors) {
		return c.json<ApiResponse>({ success: false, error: "Invalid ID" }, 400)
	}

	const lyrics = await getLyricsById(c.env, paramParsed.id)
	if (!lyrics) {
		return c.json<ApiResponse>({ success: false, error: "Lyrics not found" }, 404)
	}

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json<ApiResponse>({ success: false, error: "Invalid JSON" }, 400)
	}

	const parsed = ReportSchema(body)
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
