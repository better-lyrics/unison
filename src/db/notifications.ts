import type { D1Compat } from "@/infra/database"
import type { NotificationKind } from "@/notifications/kinds"

export interface NewNotification {
	userId: number
	kind: NotificationKind
	refId: number
	actorId: number | null
	lyricsId: number | null
	data?: Record<string, unknown>
}

export async function notify(tx: D1Compat, n: NewNotification): Promise<void> {
	if (n.actorId !== null && n.actorId === n.userId) return
	await tx
		.prepare(
			`INSERT INTO notifications (user_id, kind, ref_id, actor_id, lyrics_id, data)
			 VALUES (?, ?, ?, ?, ?, ?::jsonb)
			 ON CONFLICT (user_id, kind, ref_id) DO NOTHING`
		)
		.bind(n.userId, n.kind, n.refId, n.actorId, n.lyricsId, JSON.stringify(n.data ?? {}))
		.run()
}
