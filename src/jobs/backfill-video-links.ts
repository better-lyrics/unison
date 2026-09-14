import type { Env } from "@/types"

export async function backfillVideoLinks(env: Env): Promise<{ linked: number }> {
	const missing = await env.DB.prepare(
		`SELECT COUNT(*)::int AS n FROM lyrics l
		 WHERE NOT EXISTS (
		   SELECT 1 FROM lyrics_video_ids lvi
		   WHERE lvi.lyrics_id = l.id AND lvi.video_id = l.video_id
		 )`
	).first<{ n: number }>()

	await env.DB.prepare(
		`INSERT INTO lyrics_video_ids (lyrics_id, video_id)
		 SELECT id, video_id FROM lyrics
		 ON CONFLICT (lyrics_id, video_id) DO NOTHING`
	).run()

	return { linked: missing?.n ?? 0 }
}
