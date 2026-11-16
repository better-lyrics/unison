import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import { AUTO_HIDE_PREDICATE_JOINED } from "@/db/predicates"
import type { Env } from "@/types"

export type SuggestStanding = "allowed" | "banned" | "needs_lyric"

export async function suggestStanding(env: Env, userId: number): Promise<SuggestStanding> {
	const minLive = config.revisions.proposerMinLiveLyrics
	const row = await env.DB.prepare(
		`SELECT u.banned_at IS NOT NULL AS banned,
			(SELECT COUNT(*) FROM (
				SELECT 1 FROM lyrics l
				WHERE l.submitter_id = u.id AND l.deleted_at IS NULL AND NOT ${AUTO_HIDE_PREDICATE_JOINED}
				LIMIT ?
			) own)::int AS live
		 FROM users u WHERE u.id = ?`
	)
		.bind(minLive, userId)
		.first<{ banned: boolean; live: number }>()
	if (row?.banned) return "banned"
	if (row && row.live >= minLive) return "allowed"
	return (await isCommittee(env, userId)) ? "allowed" : "needs_lyric"
}
