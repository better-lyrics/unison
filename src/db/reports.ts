import { evictFeedCaches } from "@/db/feed"
import { openCaseIfQualified } from "@/db/flags"
import { invalidateCacheForLyric } from "@/db/lyrics"
import { Logger } from "@/infra/logger"
import type { Env, ReportRequest } from "@/types"

const log = new Logger("db")

export async function submitReport(
	env: Env,
	lyricsId: number,
	userId: number,
	report: ReportRequest
): Promise<{ success: boolean; message: string }> {
	const lyrics = await env.DB.prepare("SELECT deleted_at FROM lyrics WHERE id = ?")
		.bind(lyricsId)
		.first<{ deleted_at: number | null }>()

	if (!lyrics || lyrics.deleted_at != null) {
		return { success: false, message: "Lyrics no longer available" }
	}

	const existing = await env.DB.prepare(
		"SELECT id FROM reports WHERE lyrics_id = ? AND user_id = ?"
	)
		.bind(lyricsId, userId)
		.first()

	if (existing) {
		return { success: false, message: "Already reported" }
	}

	await env.DB.prepare(
		"INSERT INTO reports (lyrics_id, user_id, reason, details) VALUES (?, ?, ?, ?)"
	)
		.bind(lyricsId, userId, report.reason, report.details || null)
		.run()

	try {
		const caseId = await openCaseIfQualified(env, lyricsId)
		if (caseId !== null) {
			await invalidateCacheForLyric(env, lyricsId)
			await evictFeedCaches(env)
			log.warn("report case opened", { lyricsId, caseId })
		}
	} catch (err) {
		log.error("failed to open report case", { lyricsId, error: String(err) })
	}

	log.info("report submitted", { lyricsId, userId, reason: report.reason })
	return { success: true, message: "Report submitted" }
}
