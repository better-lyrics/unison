import { timingSafeEqual } from "node:crypto"
import type { Env } from "@/types"

function extractBearer(header: unknown): string | null {
	if (typeof header !== "string") return null
	const match = /^Bearer (.+)$/.exec(header)
	return match ? match[1] : null
}

function secretsMatch(provided: string, expected: string): boolean {
	const a = Buffer.from(provided)
	const b = Buffer.from(expected)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

export function isAuthorizedBot(authorizationHeader: unknown, env: Env): boolean {
	const secret = env.BUTLER_BOT_SECRET
	if (!secret) return false
	const provided = extractBearer(authorizationHeader)
	if (!provided) return false
	return secretsMatch(provided, secret)
}
