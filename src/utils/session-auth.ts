import { Elysia, status } from "elysia"
import { getOrCreateUser } from "@/db/users"
import type { Env } from "@/types"
import { buildError, ErrorCode } from "@/utils/errors"
import { getSession } from "@/utils/session"

function extractBearer(header: string | undefined): string | null {
	if (!header || !header.startsWith("Bearer ")) return null
	const token = header.slice(7).trim()
	return token.length > 0 ? token : null
}

export const sessionAuth = new Elysia({ name: "session-auth" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const env = (ctx as unknown as { env: Env }).env
		const token = extractBearer(ctx.headers.authorization)
		if (!token) {
			return status(401, buildError(ErrorCode.AUTH_REQUIRED))
		}

		const record = await getSession(env, token)
		if (!record) {
			return status(401, buildError(ErrorCode.AUTH_REQUIRED))
		}

		const user = await getOrCreateUser(env, record.keyId)
		return { keyId: record.keyId, userId: user.id }
	}
)
