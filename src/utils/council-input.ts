import { config } from "@/config"
import type { Env } from "@/types"
import { findNulCharacter } from "@/utils/validation"

export type ParsedNote = { ok: true; note: string | null } | { ok: false }

export function parseNote(body: Record<string, unknown>, maxLength: number): ParsedNote {
	const raw = body.note
	if (raw === undefined || raw === null) return { ok: true, note: null }
	if (typeof raw !== "string") return { ok: false }
	const note = raw.trim()
	if (note.length > maxLength || findNulCharacter(note)) return { ok: false }
	return { ok: true, note: note.length > 0 ? note : null }
}

export function parseCouncilNote(body: Record<string, unknown>): ParsedNote {
	return parseNote(body, config.validation.report.maxDetailsLength)
}

export async function allowCouncilWrite(env: Env, keyId: string): Promise<boolean> {
	const { success } = await env.RATE_LIMITER.limit({
		key: `council:${keyId}`,
		maxRequests: config.council.write.maxRequests,
		windowSeconds: config.council.write.windowSeconds,
	})
	return success
}
