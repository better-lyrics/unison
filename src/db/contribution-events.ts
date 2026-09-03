import type { Env } from "@/types"

export interface ContributionEvent {
	userId: number
	delta: number
	kind: string
	refType: string
	refId: number
}

export async function addEvent(env: Env, event: ContributionEvent): Promise<boolean> {
	const row = await env.DB.prepare(
		`INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (user_id, kind, ref_type, ref_id) DO NOTHING
		 RETURNING id`
	)
		.bind(event.userId, event.delta, event.kind, event.refType, event.refId)
		.first<{ id: number }>()
	return row !== null
}

export async function getXp(env: Env, userId: number): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COALESCE(SUM(delta), 0) AS xp FROM contribution_events WHERE user_id = ?"
	)
		.bind(userId)
		.first<{ xp: string | number }>()
	return Number(row?.xp ?? 0)
}
