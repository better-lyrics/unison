import { addCommittee, listCommitteeKeyIds, removeCommittee } from "@/db/committee"
import { listActiveBookmarks } from "@/db/council-bookmarks"
import { discordIdsByKeyIds } from "@/db/discordLinks"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"

export const committeeBotRoutes = (env: Env) =>
	new Elysia({ prefix: "/committee" })
		.decorate("env", env)
		.post(
			"/bot",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				await addCommittee(env, user.id, { actorId: null, source: "discord" })
				return status(200, { success: true, data: { keyId: body.keyId } })
			},
			{ body: t.Object({ keyId: t.String() }) }
		)
		.delete(
			"/bot",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) {
					return status(404, buildError(ErrorCode.NOT_FOUND))
				}
				await removeCommittee(env, user.id, { actorId: null, source: "discord" })
				return status(200, { success: true })
			},
			{ body: t.Object({ keyId: t.String() }) }
		)
		.get("/bot", async ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			const keyIds = await listCommitteeKeyIds(env)
			return status(200, { success: true, data: { keyIds } })
		})
		.get("/bookmarks/bot", async ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			const bookmarks = await listActiveBookmarks(env)
			const discordIds = await discordIdsByKeyIds(
				env,
				bookmarks.map((b) => b.holder.keyId)
			)
			return status(200, {
				success: true,
				data: {
					bookmarks: bookmarks.map((b) => ({
						id: b.id,
						itemType: b.itemType,
						itemId: b.itemId,
						lyricsId: b.lyricsId,
						holder: {
							keyId: b.holder.keyId,
							displayName: b.holder.displayName,
							discordId: discordIds.get(b.holder.keyId) ?? null,
						},
						createdAt: b.createdAt,
						expiresAt: b.expiresAt,
					})),
				},
			})
		})
