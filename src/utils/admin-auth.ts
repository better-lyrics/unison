import type { Env } from "@/types"
import { matchesBearerSecret } from "./bearer-secret"

export function isAuthorizedAdmin(authorizationHeader: unknown, env: Env): boolean {
	return matchesBearerSecret(authorizationHeader, env.ADMIN_SECRET)
}
