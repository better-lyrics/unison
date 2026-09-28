import { type CouncilSource, recordCouncilEvent } from "@/db/council-events"
import type { Env } from "@/types"

export interface CommitteeMember {
	userId: number
	addedAt: number
	addedBy: string | null
	isAdmin: boolean
}

export interface MembershipAudit {
	actorId: number | null
	source: CouncilSource
}

const ADDED_BY: Record<CouncilSource, string> = { discord: "bot", admin: "admin", web: "web" }

export async function isCommittee(env: Env, userId: number): Promise<boolean> {
	const row = await env.DB.prepare("SELECT 1 AS one FROM committee_members WHERE user_id = ?")
		.bind(userId)
		.first<{ one: number }>()
	return row !== null
}

export async function isCouncilAdmin(env: Env, userId: number): Promise<boolean> {
	const row = await env.DB.prepare(
		"SELECT 1 AS one FROM committee_members WHERE user_id = ? AND is_admin"
	)
		.bind(userId)
		.first<{ one: number }>()
	return row !== null
}

export async function getCouncilRole(env: Env, keyId: string): Promise<{ admin: boolean } | null> {
	const row = await env.DB.prepare(
		"SELECT c.is_admin FROM committee_members c JOIN users u ON u.id = c.user_id WHERE u.key_id = ?"
	)
		.bind(keyId)
		.first<{ is_admin: boolean }>()
	return row ? { admin: row.is_admin } : null
}

export async function setCouncilAdmin(env: Env, userId: number, admin: boolean): Promise<boolean> {
	const row = await env.DB.prepare(
		"UPDATE committee_members SET is_admin = ? WHERE user_id = ? RETURNING user_id"
	)
		.bind(admin, userId)
		.first<{ user_id: number }>()
	return row !== null
}

export async function syncCouncilAdmins(
	env: Env,
	entries: { keyId: string; admin: boolean }[]
): Promise<number> {
	if (entries.length === 0) return 0
	const res = await env.DB.prepare(
		`UPDATE committee_members c SET is_admin = v.admin
		 FROM unnest(?::text[], ?::boolean[]) AS v(key_id, admin)
		 JOIN users u ON u.key_id = v.key_id
		 WHERE c.user_id = u.id AND c.is_admin IS DISTINCT FROM v.admin
		 RETURNING c.user_id`
	)
		.bind(
			entries.map((e) => e.keyId),
			entries.map((e) => e.admin)
		)
		.all<{ user_id: number }>()
	return res.results.length
}

export async function addCommittee(
	env: Env,
	userId: number,
	audit: MembershipAudit
): Promise<void> {
	await env.DB.transaction(async (tx) => {
		const inserted = await tx
			.prepare(
				"INSERT INTO committee_members (user_id, added_by) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING RETURNING user_id"
			)
			.bind(userId, ADDED_BY[audit.source])
			.first<{ user_id: number }>()
		if (!inserted) return
		await recordCouncilEvent(tx, {
			actorId: audit.actorId,
			kind: "member_add",
			source: audit.source,
			subjectUserId: userId,
			refId: userId,
		})
	})
}

export async function removeCommittee(
	env: Env,
	userId: number,
	audit: MembershipAudit
): Promise<void> {
	await env.DB.transaction(async (tx) => {
		const removed = await tx
			.prepare("DELETE FROM committee_members WHERE user_id = ? RETURNING user_id")
			.bind(userId)
			.first<{ user_id: number }>()
		if (!removed) return
		await recordCouncilEvent(tx, {
			actorId: audit.actorId,
			kind: "member_remove",
			source: audit.source,
			subjectUserId: userId,
			refId: userId,
		})
	})
}

export async function listCommittee(env: Env): Promise<CommitteeMember[]> {
	const res = await env.DB.prepare(
		"SELECT user_id, added_at, added_by, is_admin FROM committee_members ORDER BY added_at DESC"
	)
		.bind()
		.all<{
			user_id: number | string
			added_at: number | string
			added_by: string | null
			is_admin: boolean
		}>()
	return res.results.map((row) => ({
		userId: Number(row.user_id),
		addedAt: Number(row.added_at),
		addedBy: row.added_by,
		isAdmin: row.is_admin,
	}))
}

export async function listCommitteeKeyIds(env: Env): Promise<string[]> {
	const res = await env.DB.prepare(
		"SELECT u.key_id FROM committee_members c JOIN users u ON u.id = c.user_id ORDER BY c.added_at DESC"
	)
		.bind()
		.all<{ key_id: string }>()
	return res.results.map((row) => row.key_id)
}
