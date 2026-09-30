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
	| "metadata_propose"
	| "metadata_approve"
	| "metadata_reject"

export type CouncilSource = "web" | "discord" | "admin"

export const DECISION_KINDS: CouncilEventKind[] = [
	"seal",
	"reject",
	"edit_approve",
	"edit_reject",
	"metadata_approve",
	"metadata_reject",
]

export const EDIT_DECISION_KINDS: CouncilEventKind[] = [
	"edit_approve",
	"edit_reject",
	"metadata_approve",
	"metadata_reject",
]

export const UNDONE_EXPR = `CASE
	WHEN e.kind = 'seal' THEN EXISTS (
		SELECT 1 FROM boosts b WHERE b.id = e.ref_id AND b.revoked_at IS NOT NULL)
	WHEN e.kind = 'reject' THEN EXISTS (
		SELECT 1 FROM rejections r WHERE r.id = e.ref_id AND r.revoked_at IS NOT NULL)
	ELSE FALSE
END`

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
	cursor?: EventsCursor
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

export interface EventsCursor {
	at: number
	id: number
}

export function parseEventsCursor(cursor: string): EventsCursor | null {
	const match = /^(\d+):(\d+)$/.exec(cursor)
	return match ? { at: Number(match[1]), id: Number(match[2]) } : null
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
	if (opts.cursor) {
		where.push("(e.created_at, e.id) < (?, ?)")
		params.push(opts.cursor.at, opts.cursor.id)
	}
	const rows = await env.DB.prepare(
		`SELECT e.id, e.kind, e.source, e.created_at, e.note, e.actor_id, e.subject_user_id,
			l.id AS lyric_id, l.video_id, l.song, l.artist,
			${UNDONE_EXPR} AS undone
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

const unrecorded = (kinds: string, ref: string) =>
	`NOT EXISTS (SELECT 1 FROM council_events e WHERE e.kind IN (${kinds}) AND e.ref_id = ${ref})`

const HISTORY_BACKFILLS = [
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT b.booster_id, 'seal', 'discord', b.lyrics_id, b.id, b.created_at FROM boosts b
	 WHERE ${unrecorded("'seal'", "b.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unseal', 'discord', b.lyrics_id, b.id, b.revoked_at FROM boosts b
	 WHERE b.revoked_at IS NOT NULL AND ${unrecorded("'unseal'", "b.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT r.rejected_by, 'reject', 'discord', r.lyrics_id, r.id, r.note, r.rejected_at FROM rejections r
	 WHERE ${unrecorded("'reject'", "r.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, created_at)
	 SELECT NULL, 'unreject', 'discord', r.lyrics_id, r.id, r.revoked_at FROM rejections r
	 WHERE r.revoked_at IS NOT NULL AND ${unrecorded("'unreject'", "r.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, lyrics_id, ref_id, note, created_at)
	 SELECT lr.reviewed_by,
		CASE WHEN lr.status = 'rejected' THEN 'edit_reject' ELSE 'edit_approve' END,
		'discord', lr.lyrics_id, lr.id, lr.review_note, lr.reviewed_at
	 FROM lyric_revisions lr
	 WHERE lr.reviewed_by IS NOT NULL AND lr.reviewed_at IS NOT NULL
		AND lr.status IN ('live', 'past', 'rejected')
		AND ${unrecorded("'edit_approve', 'edit_reject'", "lr.id")}
	 ON CONFLICT DO NOTHING RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, subject_user_id, ref_id, created_at)
	 SELECT NULL, 'member_add', CASE WHEN c.added_by = 'bot' THEN 'discord' ELSE 'admin' END,
		c.user_id, c.user_id, c.added_at
	 FROM committee_members c
	 WHERE NOT EXISTS (
		SELECT 1 FROM council_events e WHERE e.kind = 'member_add' AND e.subject_user_id = c.user_id)
	 RETURNING id`,
	`INSERT INTO council_events (actor_id, kind, source, subject_user_id, ref_id, created_at)
	 SELECT decider.id,
		CASE WHEN s.state = 'approved' THEN 'applicant_approve' ELSE 'applicant_reject' END,
		'discord', applicant.id, s.id, s.decided_at
	 FROM exam_session s
	 LEFT JOIN users applicant ON applicant.key_id = s.key_id
	 LEFT JOIN discord_links dl ON dl.discord_id = s.decided_by_discord_id
	 LEFT JOIN users decider ON decider.key_id = dl.key_id
	 WHERE s.state IN ('approved', 'rejected') AND s.decided_at IS NOT NULL AND s.is_dev = FALSE
		AND ${unrecorded("'applicant_approve', 'applicant_reject'", "s.id")}
	 RETURNING id`,
]

// Set-based on purpose: one statement per kind, and a no-op run writes nothing.
export async function recordMissingHistory(db: D1Compat): Promise<number> {
	let inserted = 0
	for (const sql of HISTORY_BACKFILLS) {
		const rows = await db.prepare(sql).bind().all<{ id: number }>()
		inserted += rows.results.length
	}
	return inserted
}
