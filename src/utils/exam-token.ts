import { generateSessionToken } from "./session"

export function generateExamToken(): string {
	return generateSessionToken()
}

export async function hashExamToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}
