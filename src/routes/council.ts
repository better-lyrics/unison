import { isCommittee, isCouncilAdmin } from "@/db/committee"
import { type BookmarkItemType, createBookmark, releaseBookmark } from "@/db/council-bookmarks"
import { listCouncilEdits } from "@/db/council-edits"
import { listCouncilQueue, toQueueBookmark } from "@/db/council-queue"
import { getCuratorTierMap } from "@/db/leaderboard"
import type { Env } from "@/types"
import { allowCouncilWrite } from "@/utils/council-input"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia } from "elysia"

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
					data: { ...toQueueBookmark(result.bookmark, tiers), itemType, itemId, lyricsId },
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
