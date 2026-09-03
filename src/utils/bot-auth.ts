import type { Env } from "@/types"
import { matchesBearerSecret } from "./bearer-secret"

export function isAuthorizedBot(authorizationHeader: unknown, env: Env): boolean {
	return matchesBearerSecret(authorizationHeader, env.BUTLER_BOT_SECRET)
}
