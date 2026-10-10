import { config } from "@/config"
import {
	addCommittee,
	listCommitteeKeyIds,
	removeCommittee,
	syncCouncilAdmins,
} from "@/db/committee"
import { listActiveBookmarks } from "@/db/council-bookmarks"
import { listBotFlags } from "@/db/council-flags"
import { discordIdsByKeyIds } from "@/db/discordLinks"
import { castFlagVote } from "@/db/flags"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { parseCouncilNote } from "@/utils/council-input"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia, t } from "elysia"
import { flagVoteError, settleFlagVote } from "./flag-vote"

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
		.put(
			"/bot/admins",
			async ({ env, headers, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const changed = await syncCouncilAdmins(env, body.admins)
				return status(200, { success: true, data: { changed } })
			},
			{
				body: t.Object({
					admins: t.Array(t.Object({ keyId: t.String({ maxLength: 128 }), admin: t.Boolean() }), {
						maxItems: 500,
					}),
				}),
			}
		)
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
		.get("/flags/bot", async ({ env, headers, status }) => {
			if (!isAuthorizedBot(headers.authorization, env)) {
				return status(401, buildError(ErrorCode.AUTH_REQUIRED))
			}
			const nowSec = Math.floor(Date.now() / 1000)
			return { success: true, data: await listBotFlags(env, nowSec - 24 * 60 * 60) }
		})
		.post(
			"/flags/:id/vote/bot",
			async ({ env, headers, params, body, status }) => {
				if (!isAuthorizedBot(headers.authorization, env)) {
					return status(401, buildError(ErrorCode.AUTH_REQUIRED))
				}
				const id = Number(params.id)
				if (!Number.isInteger(id) || id <= 0) return status(400, buildError(ErrorCode.INVALID_ID))
				const user = await getUserByKeyId(env, body.keyId)
				if (!user) return status(403, buildError(ErrorCode.NOT_COMMITTEE))
				const note = parseCouncilNote(body)
				if (!note.ok) return status(400, buildError(ErrorCode.INVALID_PAYLOAD))
				const result = await castFlagVote(env, id, user.id, body.remove, note.note, "discord")
				if (!result.ok) {
					const failure = flagVoteError(result.reason)
					return status(failure.status, failure.body)
				}
				return { success: true, data: await settleFlagVote(env, result) }
			},
			{
				params: t.Object({ id: t.String() }),
				body: t.Object({
					keyId: t.String(),
					remove: t.Boolean(),
					note: t.Optional(t.String({ maxLength: config.validation.report.maxDetailsLength })),
				}),
			}
		)
