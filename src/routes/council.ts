import { isCommittee, isCouncilAdmin } from "@/db/committee"
import { listCouncilQueue } from "@/db/council-queue"
import type { Env } from "@/types"
import { eitherAuth } from "@/utils/either-auth"
import { ErrorCode, buildError } from "@/utils/errors"
import { Elysia } from "elysia"

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
