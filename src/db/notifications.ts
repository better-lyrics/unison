import { config } from "@/config"
import type { D1Compat } from "@/infra/database"
import { type NotificationKind, REVISION_KINDS, WAITING_KINDS } from "@/notifications/kinds"

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

export interface NotificationItem {
	id: number
	kind: NotificationKind
	refId: number
	refStatus: string | null
	actorId: number | null
	createdAt: number
	unread: boolean
	data: Record<string, unknown>
	lyric: { id: number; videoId: string; song: string; artist: string } | null
}

interface ItemRow {
	id: string
	kind: NotificationKind
	ref_id: string
	ref_status: string | null
	actor_id: number | null
	created_at: number
	unread: boolean
	data: Record<string, unknown>
	lyrics_id: number | null
	video_id: string | null
	song: string | null
	artist: string | null
}

const VISIBLE_SQL = `
	SELECT n.id, n.kind, n.ref_id, n.actor_id, n.data, n.created_at,
		n.created_at > me.notifications_seen_at AS unread,
		l.id AS lyrics_id, l.video_id, l.song, l.artist,
		r.status AS ref_status
	FROM notifications n
	JOIN users me ON me.id = n.user_id
	LEFT JOIN users a ON a.id = n.actor_id
	LEFT JOIN lyrics l ON l.id = n.lyrics_id
	LEFT JOIN lyric_revisions r ON r.id = n.ref_id AND n.kind = ANY(?)
	WHERE n.user_id = ?
		AND (a.id IS NULL OR a.banned_at IS NULL)
		AND (l.id IS NULL OR l.deleted_at IS NULL)
		AND (r.status IS NULL OR r.status NOT IN ('withdrawn', 'superseded'))
		AND (n.created_at > ? OR (n.kind = ANY(?) AND r.status = 'pending'))`

const visibleParams = (userId: number, now: number) => [
	REVISION_KINDS,
	userId,
	now - config.notifications.windowSec,
	WAITING_KINDS,
]

const toItem = (row: ItemRow): NotificationItem => ({
	id: Number(row.id),
	kind: row.kind,
	refId: Number(row.ref_id),
	refStatus: row.ref_status,
	actorId: row.actor_id,
	createdAt: row.created_at,
	unread: row.unread,
	data: row.data,
	lyric:
		row.lyrics_id === null
			? null
			: {
					id: row.lyrics_id,
					videoId: row.video_id as string,
					song: row.song as string,
					artist: row.artist as string,
				},
})

export async function unreadCount(
	db: D1Compat,
	userId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<number> {
	const row = await db
		.prepare(`SELECT COUNT(*)::int AS n FROM (${VISIBLE_SQL}) x WHERE x.unread`)
		.bind(...visibleParams(userId, now))
		.first<{ n: number }>()
	return row?.n ?? 0
}

export async function listNotifications(
	db: D1Compat,
	userId: number,
	now = Math.floor(Date.now() / 1000)
): Promise<{ unread: number; items: NotificationItem[] }> {
	const { results } = await db
		.prepare(`${VISIBLE_SQL} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`)
		.bind(...visibleParams(userId, now), config.notifications.listMax)
		.all<ItemRow>()
	return { unread: await unreadCount(db, userId, now), items: results.map(toItem) }
}

export async function markSeen(db: D1Compat, userId: number): Promise<void> {
	await db
		.prepare(
			"UPDATE users SET notifications_seen_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?"
		)
		.bind(userId)
		.run()
}

export async function getDiscordDm(db: D1Compat, userId: number): Promise<boolean> {
	const row = await db
		.prepare("SELECT notify_discord FROM users WHERE id = ?")
		.bind(userId)
		.first<{ notify_discord: boolean }>()
	return row?.notify_discord ?? false
}

export async function setDiscordDm(db: D1Compat, userId: number, on: boolean): Promise<void> {
	await db.prepare("UPDATE users SET notify_discord = ? WHERE id = ?").bind(on, userId).run()
}
