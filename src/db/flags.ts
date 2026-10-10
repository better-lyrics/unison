import { config } from "@/config"
import type { Env } from "@/types"

const { reportHide } = config.moderation

const QUALIFYING_REPORTS = `JOIN users u ON u.id = r.user_id
	WHERE r.reason IN (${reportHide.reasons.map(() => "?").join(", ")})
		AND u.reputation >= ? AND u.vote_count >= ? AND u.banned_at IS NULL
		AND r.created_at > COALESCE(
			(SELECT MAX(kept.decided_at) FROM report_cases kept
				WHERE kept.lyrics_id = r.lyrics_id AND kept.status = 'kept'),
			0
		)`

const QUALIFYING_PARAMS = [
	...reportHide.reasons,
	reportHide.minReporterReputation,
	reportHide.minReporterVotes,
]

export async function openCaseIfQualified(env: Env, lyricsId: number): Promise<number | null> {
	const count = await env.DB.prepare(
		`SELECT COUNT(*)::INTEGER AS n FROM reports r ${QUALIFYING_REPORTS}
			AND r.lyrics_id = ?
			AND EXISTS (SELECT 1 FROM lyrics l WHERE l.id = r.lyrics_id AND l.deleted_at IS NULL)`
	)
		.bind(...QUALIFYING_PARAMS, lyricsId)
		.first<{ n: number }>()
	if ((count?.n ?? 0) < reportHide.threshold) return null

	const opened = await env.DB.prepare(
		`INSERT INTO report_cases (lyrics_id) VALUES (?)
			ON CONFLICT (lyrics_id) WHERE status = 'open' DO NOTHING
			RETURNING id`
	)
		.bind(lyricsId)
		.first<{ id: number }>()
	return opened ? Number(opened.id) : null
}
