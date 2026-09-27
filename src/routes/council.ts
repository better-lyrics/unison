import { config } from "@/config"
import { addCommittee, isCommittee, isCouncilAdmin, removeCommittee } from "@/db/committee"
import {
	type BookmarkItemType,
	createBookmark,
	releaseBookmark,
	toBookmarkView,
} from "@/db/council-bookmarks"
import { listCouncilEdits } from "@/db/council-edits"
import { type CouncilEventKind, listCouncilEvents } from "@/db/council-events"
import { listCouncilQueue } from "@/db/council-queue"
import { getCouncilOverview, getCouncilRoster } from "@/db/council-stats"
import { getCuratorTierMap } from "@/db/leaderboard"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { allowCouncilWrite } from "@/utils/council-input"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"

function parseBookmarkBody(
	body: Record<string, unknown>
): { itemType: BookmarkItemType; itemId: number } | null {
	const { itemType, itemId } = body
	if (itemType !== "seal" && itemType !== "edit") return null
	if (typeof itemId !== "number" || !Number.isInteger(itemId) || itemId <= 0) return null
	return { itemType, itemId }
}

function parseId(raw: string): number | null {
	const id = Number(raw)
	return Number.isInteger(id) && id > 0 ? id : null
}

const EVENT_GROUPS: Record<string, CouncilEventKind[]> = {
	seals: ["seal", "unseal"],
	rejections: ["reject", "unreject"],
	edits: ["edit_approve", "edit_reject"],
	membership: ["member_add", "member_remove", "applicant_approve", "applicant_reject"],
}

const notAdmin = () => buildError(ErrorCode.NOT_COUNCIL_ADMIN)

export const councilRoutes = (env: Env) =>
	new Elysia({ prefix: "/committee" })
		.decorate("env", env)
		.use(eitherAuth)
		.resolve(async ({ env, userId, status }) => {
			if (!(await isCommittee(env, userId))) {
				return status(403, buildError(ErrorCode.NOT_COMMITTEE))
			}
			return { councilAdmin: await isCouncilAdmin(env, userId) }
		})
		.get("/queue", async ({ env }) => ({ success: true, data: await listCouncilQueue(env) }))
		.get("/edits", async ({ env }) => ({ success: true, data: await listCouncilEdits(env) }))
		.post("/bookmarks", async ({ env, userId, keyId, body, status }) => {
			const input = parseBookmarkBody(body)
			if (!input) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			if (!(await allowCouncilWrite(env, keyId)))
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			const result = await createBookmark(env, userId, input.itemType, input.itemId, "web")
			if (result.ok) {
				const { itemType, itemId, lyricsId } = result.bookmark
				const tiers = await getCuratorTierMap(env)
				return {
					success: true,
					data: { ...toBookmarkView(result.bookmark, tiers), itemType, itemId, lyricsId },
				}
			}
			switch (result.reason) {
				case "held":
					return status(
						409,
						buildError(ErrorCode.BOOKMARK_HELD, {
							hint: `${result.heldBy.holder.displayName} bookmarked this item. It returns to the open queue when they decide, release it, or the bookmark expires.`,
						})
					)
				case "cap":
					return status(409, buildError(ErrorCode.BOOKMARK_CAP))
				case "item_not_found":
					return status(404, buildError(ErrorCode.NOT_FOUND))
				case "not_committee":
					return status(403, buildError(ErrorCode.NOT_COMMITTEE))
			}
		})
		.delete("/bookmarks/:id", async ({ env, userId, keyId, params, status }) => {
			const id = parseId(params.id)
			if (id === null) return status(400, buildError(ErrorCode.INVALID_ID))
			if (!(await allowCouncilWrite(env, keyId)))
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			const result = await releaseBookmark(env, userId, id, "web")
			if (result.ok) return { success: true }
			return result.reason === "forbidden"
				? status(
						403,
						buildError(ErrorCode.NOT_OWNER, {
							error: "Not your bookmark",
							hint: "You can only release a bookmark you placed.",
						})
					)
				: status(404, buildError(ErrorCode.NOT_FOUND))
		})
		.get(
			"/events",
			async ({ env, query, status }) => {
				const kinds =
					query.kind === undefined
						? undefined
						: Object.hasOwn(EVENT_GROUPS, query.kind)
							? EVENT_GROUPS[query.kind]
							: null
				if (kinds === null) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
				const lyricsId = query.lyric === undefined ? undefined : parseId(query.lyric)
				if (lyricsId === null) return status(400, buildError(ErrorCode.INVALID_ID))
				const limit = Math.min(
					config.council.eventsPageSize,
					Math.max(1, Number(query.limit) || config.council.eventsPageSize)
				)
				const page = await listCouncilEvents(env, {
					kinds,
					actorKeyId: query.actor,
					lyricsId,
					includeBookmarks: query.includeBookmarks === "1",
					cursor: query.cursor,
					limit,
				})
				return { success: true, data: page }
			},
			{
				query: t.Object({
					kind: t.Optional(t.String()),
					actor: t.Optional(t.String({ maxLength: 128 })),
					lyric: t.Optional(t.String()),
					includeBookmarks: t.Optional(t.String()),
					cursor: t.Optional(t.String({ maxLength: 64 })),
					limit: t.Optional(t.String()),
				}),
			}
		)
		.get(
			"/overview",
			async ({ env, userId, query }) => ({
				success: true,
				data: await getCouncilOverview(env, {
					meId: userId,
					scope: query.scope === "me" ? "me" : "council",
				}),
			}),
			{ query: t.Object({ scope: t.Optional(t.String()) }) }
		)
		.get("/members", async ({ env, userId }) => ({
			success: true,
			data: await getCouncilRoster(env, { meId: userId }),
		}))
		.post("/members", async ({ env, userId, keyId, councilAdmin, body, status }) => {
			if (!councilAdmin) return status(403, notAdmin())
			if (typeof body.keyId !== "string" || body.keyId.length === 0) {
				return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
			}
			if (!(await allowCouncilWrite(env, keyId)))
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			const member = await getUserByKeyId(env, body.keyId)
			if (!member) return status(404, buildError(ErrorCode.NOT_FOUND))
			await addCommittee(env, member.id, { actorId: userId, source: "web" })
			return { success: true, data: { keyId: body.keyId } }
		})
		.delete("/members/:keyId", async ({ env, userId, keyId, councilAdmin, params, status }) => {
			if (!councilAdmin) return status(403, notAdmin())
			if (!(await allowCouncilWrite(env, keyId)))
				return status(429, buildError(ErrorCode.RATE_LIMITED))
			const member = await getUserByKeyId(env, params.keyId)
			if (!member) return status(404, buildError(ErrorCode.NOT_FOUND))
			await removeCommittee(env, member.id, { actorId: userId, source: "web" })
			return { success: true }
		})
