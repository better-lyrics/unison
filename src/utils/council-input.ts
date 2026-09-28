import { config } from "@/config"
import type { Env } from "@/types"

export type ParsedNote = { ok: true; note: string | null } | { ok: false }

export function parseCouncilNote(body: Record<string, unknown>): ParsedNote {
	const raw = body.note
	if (raw === undefined || raw === null) return { ok: true, note: null }
	if (typeof raw !== "string") return { ok: false }
	const note = raw.trim()
	if (note.length > config.validation.report.maxDetailsLength) return { ok: false }
	return { ok: true, note: note.length > 0 ? note : null }
}

export async function allowCouncilWrite(env: Env, keyId: string): Promise<boolean> {
	const { success } = await env.RATE_LIMITER.limit({
		key: `council:${keyId}`,
		maxRequests: config.council.write.maxRequests,
		windowSeconds: config.council.write.windowSeconds,
	})
	return success
}
