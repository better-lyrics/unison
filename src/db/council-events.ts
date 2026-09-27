import { type Person, resolvePeople } from "@/db/users"
import type { D1Compat } from "@/infra/database"
import type { Env } from "@/types"

export type CouncilEventKind =
	| "seal"
	| "unseal"
	| "reject"
	| "unreject"
	| "edit_approve"
	| "edit_reject"
	| "bookmark"
	| "release"
	| "member_add"
	| "member_remove"
	| "applicant_approve"
	| "applicant_reject"

export type CouncilSource = "web" | "discord" | "admin"

export interface CouncilEventInput {
	actorId: number | null
	kind: CouncilEventKind
	source: CouncilSource
	lyricsId?: number | null
	refId?: number | null
	subjectUserId?: number | null
	note?: string | null
	at?: number
}

export interface CouncilEventLyric {
	id: number
	videoId: string
	song: string
	artist: string
}

export interface CouncilEvent {
	id: number
	kind: CouncilEventKind
	source: CouncilSource
	at: number
	note: string | null
	undone: boolean
	actor: Person | null
	subject: Person | null
	lyric: CouncilEventLyric | null
}

export interface ListCouncilEventsOptions {
	kinds?: CouncilEventKind[]
	actorKeyId?: string
	lyricsId?: number
	includeBookmarks: boolean
	cursor?: string
	limit: number
}

export async function recordCouncilEvent(db: D1Compat, e: CouncilEventInput): Promise<void> {
	await db
		.prepare(
			`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, subject_user_id, note, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`
		)
		.bind(
			e.actorId,
			e.kind,
			e.source,
			e.lyricsId ?? null,
			e.refId ?? null,
			e.subjectUserId ?? null,
			e.note ?? null,
			e.at ?? Math.floor(Date.now() / 1000)
		)
		.run()
}

function parseCursor(cursor: string | undefined): { at: number; id: number } | null {
	if (!cursor) return null
	const [at, id] = cursor.split(":").map(Number)
	if (!Number.isInteger(at) || !Number.isInteger(id)) return null
	return { at, id }
}

interface EventRow {
	id: number | string
	kind: CouncilEventKind
	source: CouncilSource
	created_at: number | string
	note: string | null
	actor_id: number | string | null
	subject_user_id: number | string | null
	lyric_id: number | string | null
	video_id: string | null
	song: string | null
	artist: string | null
	undone: boolean
}

export async function listCouncilEvents(
	env: Env,
	opts: ListCouncilEventsOptions
): Promise<{ events: CouncilEvent[]; nextCursor: string | null }> {
	const where: string[] = []
	const params: unknown[] = []
	if (!opts.includeBookmarks) where.push("e.kind NOT IN ('bookmark', 'release')")
	if (opts.kinds && opts.kinds.length > 0) {
		where.push("e.kind = ANY(?)")
		params.push(opts.kinds)
	}
	if (opts.actorKeyId) {
		where.push("e.actor_id = (SELECT id FROM users WHERE key_id = ?)")
		params.push(opts.actorKeyId)
	}
	if (opts.lyricsId !== undefined) {
		where.push("e.lyrics_id = ?")
		params.push(opts.lyricsId)
	}
	const cursor = parseCursor(opts.cursor)
	if (cursor) {
		where.push("(e.created_at, e.id) < (?, ?)")
		params.push(cursor.at, cursor.id)
	}
	const rows = await env.DB.prepare(
		`SELECT e.id, e.kind, e.source, e.created_at, e.note, e.actor_id, e.subject_user_id,
			l.id AS lyric_id, l.video_id, l.song, l.artist,
			CASE
				WHEN e.kind = 'seal' THEN EXISTS (
					SELECT 1 FROM boosts b WHERE b.id = e.ref_id AND b.revoked_at IS NOT NULL)
				WHEN e.kind = 'reject' THEN EXISTS (
					SELECT 1 FROM rejections r WHERE r.id = e.ref_id AND r.revoked_at IS NOT NULL)
				ELSE FALSE
			END AS undone
		 FROM council_events e
		 LEFT JOIN lyrics l ON l.id = e.lyrics_id
		 ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
		 ORDER BY e.created_at DESC, e.id DESC
		 LIMIT ?`
	)
		.bind(...params, opts.limit + 1)
		.all<EventRow>()

	const page = rows.results.slice(0, opts.limit)
	const people = await resolvePeople(
		env,
		page
			.flatMap((r) => [r.actor_id, r.subject_user_id])
			.filter((id) => id !== null)
			.map(Number)
	)
	const person = (id: number | string | null) =>
		id === null ? null : (people.get(Number(id)) ?? null)
	const events = page.map((r) => ({
		id: Number(r.id),
		kind: r.kind,
		source: r.source,
		at: Number(r.created_at),
		note: r.note,
		undone: r.undone,
		actor: person(r.actor_id),
		subject: person(r.subject_user_id),
		lyric:
			r.lyric_id === null
				? null
				: {
						id: Number(r.lyric_id),
						videoId: r.video_id ?? "",
						song: r.song ?? "",
						artist: r.artist ?? "",
					},
	}))
	const last = page[page.length - 1]
	const nextCursor =
		rows.results.length > opts.limit && last
			? `${Number(last.created_at)}:${Number(last.id)}`
			: null
	return { events, nextCursor }
}
