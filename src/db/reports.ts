import { config } from "@/config"
import { Logger } from "@/infra/logger"
import { recalculateScore } from "@/jobs/score-updater"
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

	const reportCount = await env.DB.prepare(
		"SELECT COUNT(*) as count FROM reports WHERE lyrics_id = ?"
	)
		.bind(lyricsId)
		.first<{ count: number }>()

	if (reportCount && reportCount.count >= config.moderation.reportsThreshold) {
		recalculateScore(env, lyricsId).catch((err) =>
			log.error("background recalculation failed after reports", {
				lyricsId,
				error: String(err),
			})
		)
		log.warn("report threshold reached, recalculating score", {
			lyricsId,
			reports: reportCount.count,
		})
	}

	log.info("report submitted", { lyricsId, userId, reason: report.reason })
	return { success: true, message: "Report submitted" }
}
