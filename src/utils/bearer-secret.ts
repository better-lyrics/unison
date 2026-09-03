import { timingSafeEqual } from "node:crypto"

function extractBearer(header: unknown): string | null {
	if (typeof header !== "string") return null
	const match = /^Bearer (.+)$/.exec(header)
	return match ? match[1] : null
}

export function matchesBearerSecret(header: unknown, secret: string | null | undefined): boolean {
	if (!secret) return false
	const provided = extractBearer(header)
	if (!provided) return false
	const a = Buffer.from(provided)
	const b = Buffer.from(secret)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}
