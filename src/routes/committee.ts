import { addCommittee, listCommitteeKeyIds, removeCommittee } from "@/db/committee"
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
				await addCommittee(env, user.id, "bot")
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
				await removeCommittee(env, user.id)
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
