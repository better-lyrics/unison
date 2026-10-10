import { NOW_EPOCH } from "@/db/predicates"
import { type D1Compat, advisoryXactLock } from "@/infra/database"

export type ClosedCaseStatus = "removed" | "kept"

export function lockLyricCases(tx: D1Compat, lyricsId: number): Promise<void> {
	return advisoryXactLock(tx, `flag:${lyricsId}`)
}

export async function insertOpenCase(db: D1Compat, lyricsId: number): Promise<number | null> {
	const opened = await db
		.prepare(
			`INSERT INTO report_cases (lyrics_id) VALUES (?)
				ON CONFLICT (lyrics_id) WHERE status = 'open' DO NOTHING
				RETURNING id`
		)
		.bind(lyricsId)
		.first<{ id: number }>()
	return opened ? Number(opened.id) : null
}

export async function closeCase(
	db: D1Compat,
	caseId: number,
	status: ClosedCaseStatus
): Promise<void> {
	await db
		.prepare(`UPDATE report_cases SET status = ?, decided_at = ${NOW_EPOCH} WHERE id = ?`)
		.bind(status, caseId)
		.run()
}

export async function closeOpenCaseForLyric(db: D1Compat, lyricsId: number): Promise<boolean> {
	const closed = await db
		.prepare(
			`UPDATE report_cases SET status = 'removed', decided_at = ${NOW_EPOCH}
				WHERE lyrics_id = ? AND status = 'open'
				RETURNING id`
		)
		.bind(lyricsId)
		.first<{ id: number }>()
	return closed !== null
}
