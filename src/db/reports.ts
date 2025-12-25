import { config } from "@/config"
import type { Env, ReportRequest } from "@/types"

export async function submitReport(
	env: Env,
	lyricsId: number,
	userId: number,
	report: ReportRequest
): Promise<{ success: boolean; message: string }> {
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

	if (reportCount && reportCount.count >= config.moderation.reportsBeforePenalty) {
		await env.DB.prepare("UPDATE lyrics SET score = score - ? WHERE id = ?")
			.bind(config.moderation.penaltyScoreDeduction, lyricsId)
			.run()
	}

	return { success: true, message: "Report submitted" }
}
