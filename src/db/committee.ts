import type { Env } from "@/types"

export interface CommitteeMember {
	userId: number
	addedAt: number
	addedBy: string | null
}

export async function isCommittee(env: Env, userId: number): Promise<boolean> {
	const row = await env.DB.prepare("SELECT 1 AS one FROM committee_members WHERE user_id = ?")
		.bind(userId)
		.first<{ one: number }>()
	return row !== null
}

export async function addCommittee(env: Env, userId: number, addedBy: string): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO committee_members (user_id, added_by) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING"
	)
		.bind(userId, addedBy)
		.run()
}

export async function removeCommittee(env: Env, userId: number): Promise<void> {
	await env.DB.prepare("DELETE FROM committee_members WHERE user_id = ?").bind(userId).run()
}

export async function listCommittee(env: Env): Promise<CommitteeMember[]> {
	const res = await env.DB.prepare(
		"SELECT user_id, added_at, added_by FROM committee_members ORDER BY added_at DESC"
	)
		.bind()
		.all<{ user_id: number | string; added_at: number | string; added_by: string | null }>()
	return res.results.map((row) => ({
		userId: Number(row.user_id),
		addedAt: Number(row.added_at),
		addedBy: row.added_by,
	}))
}
