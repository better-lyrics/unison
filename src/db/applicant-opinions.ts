import type { Env } from "@/types"

export type OpinionStance = "support" | "object"

export interface ApplicantOpinion {
	userId: number
	stance: OpinionStance
	note: string | null
	updatedAt: number
}

export async function setOpinion(
	env: Env,
	examSessionId: number,
	userId: number,
	stance: OpinionStance | null,
	note: string | null
): Promise<boolean> {
	const session = await env.DB.prepare(
		"SELECT id FROM exam_session WHERE id = ? AND state = 'pending_review' AND NOT is_dev"
	)
		.bind(examSessionId)
		.first<{ id: number | string }>()
	if (!session) return false
	if (stance === null) {
		await env.DB.prepare("DELETE FROM applicant_opinions WHERE exam_session_id = ? AND user_id = ?")
			.bind(examSessionId, userId)
			.run()
		return true
	}
	await env.DB.prepare(
		`INSERT INTO applicant_opinions (exam_session_id, user_id, stance, note, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (exam_session_id, user_id)
		 DO UPDATE SET stance = EXCLUDED.stance, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`
	)
		.bind(examSessionId, userId, stance, note, Math.floor(Date.now() / 1000))
		.run()
	return true
}

export async function listOpinions(
	env: Env,
	examSessionIds: number[]
): Promise<Map<number, ApplicantOpinion[]>> {
	const bySession = new Map<number, ApplicantOpinion[]>()
	if (examSessionIds.length === 0) return bySession
	const rows = await env.DB.prepare(
		`SELECT exam_session_id, user_id, stance, note, updated_at FROM applicant_opinions
		 WHERE exam_session_id = ANY(?) ORDER BY updated_at ASC, user_id ASC`
	)
		.bind(examSessionIds)
		.all<{
			exam_session_id: number | string
			user_id: number | string
			stance: OpinionStance
			note: string | null
			updated_at: number | string
		}>()
	for (const r of rows.results) {
		const sessionId = Number(r.exam_session_id)
		const list = bySession.get(sessionId) ?? []
		list.push({
			userId: Number(r.user_id),
			stance: r.stance,
			note: r.note,
			updatedAt: Number(r.updated_at),
		})
		bySession.set(sessionId, list)
	}
	return bySession
}
