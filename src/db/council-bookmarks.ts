import { config } from "@/config"
import { isCommittee } from "@/db/committee"
import { type CouncilSource, recordCouncilEvent } from "@/db/council-events"
import { type CouncilPerson, type PersonDecor, toCouncilPerson } from "@/db/council-person"
import { UNDECIDED_LYRIC_JOINED } from "@/db/predicates"
import { type Person, resolvePeople } from "@/db/users"
import { type D1Compat, advisoryXactLock } from "@/infra/database"
import type { Env } from "@/types"

export type BookmarkItemType = "seal" | "edit"

export interface ActiveBookmark {
	id: number
	itemType: BookmarkItemType
	itemId: number
	lyricsId: number
	holder: Person
	createdAt: number
	expiresAt: number
}

export interface BookmarkView {
	id: number
	holder: CouncilPerson
	createdAt: number
	expiresAt: number
}

export function toBookmarkView(bookmark: ActiveBookmark, decor: PersonDecor): BookmarkView {
	return {
		id: bookmark.id,
		holder: toCouncilPerson(bookmark.holder, decor),
		createdAt: bookmark.createdAt,
		expiresAt: bookmark.expiresAt,
	}
}

export type BookmarkResult =
	| { ok: true; bookmark: ActiveBookmark }
	| { ok: false; reason: "not_committee" | "item_not_found" | "cap" }
	| { ok: false; reason: "held"; heldBy: ActiveBookmark }

export type ReleaseResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" }

export interface BookmarkFilter {
	itemType?: BookmarkItemType
	itemIds?: number[]
	userId?: number
}

const now = () => Math.floor(Date.now() / 1000)

export function bookmarkActiveSince(at: number): number {
	return at - config.council.bookmarkTtlSec
}

interface BookmarkRow {
	id: number | string
	user_id: number | string
	item_type: BookmarkItemType
	item_id: number | string
	lyrics_id: number | string
	created_at: number | string
}

const HELD_ITEM = `EXISTS (SELECT 1 FROM committee_members c WHERE c.user_id = b.user_id)
	AND CASE WHEN b.item_type = 'seal'
		THEN EXISTS (SELECT 1 FROM lyrics l WHERE l.id = b.item_id AND ${UNDECIDED_LYRIC_JOINED})
		ELSE EXISTS (SELECT 1 FROM lyric_revisions r WHERE r.id = b.item_id AND r.status = 'pending')
	END`

const ACTIVE_SELECT = `SELECT b.id, b.user_id, b.item_type, b.item_id, b.created_at,
		CASE WHEN b.item_type = 'seal' THEN b.item_id
			ELSE (SELECT r.lyrics_id FROM lyric_revisions r WHERE r.id = b.item_id) END AS lyrics_id
	 FROM council_bookmarks b
	 WHERE b.released_at IS NULL AND b.created_at > ? AND ${HELD_ITEM}`

async function queryActive(
	env: Env,
	db: D1Compat,
	filter: BookmarkFilter
): Promise<ActiveBookmark[]> {
	const where: string[] = []
	const params: unknown[] = [bookmarkActiveSince(now())]
	if (filter.itemType) {
		where.push("b.item_type = ?")
		params.push(filter.itemType)
	}
	if (filter.itemIds) {
		where.push("b.item_id = ANY(?)")
		params.push(filter.itemIds)
	}
	if (filter.userId !== undefined) {
		where.push("b.user_id = ?")
		params.push(filter.userId)
	}
	const rows = await db
		.prepare(
			`${ACTIVE_SELECT}${where.map((w) => ` AND ${w}`).join("")} ORDER BY b.created_at ASC, b.id ASC`
		)
		.bind(...params)
		.all<BookmarkRow>()
	const holders = await resolvePeople(
		{ ...env, DB: db },
		rows.results.map((r) => Number(r.user_id))
	)
	return rows.results.flatMap((r) => {
		const holder = holders.get(Number(r.user_id))
		if (!holder) return []
		const createdAt = Number(r.created_at)
		return [
			{
				id: Number(r.id),
				itemType: r.item_type,
				itemId: Number(r.item_id),
				lyricsId: Number(r.lyrics_id),
				holder,
				createdAt,
				expiresAt: createdAt + config.council.bookmarkTtlSec,
			},
		]
	})
}

export function listActiveBookmarks(
	env: Env,
	filter: BookmarkFilter = {}
): Promise<ActiveBookmark[]> {
	return queryActive(env, env.DB, filter)
}

async function itemLyricsId(
	db: D1Compat,
	itemType: BookmarkItemType,
	itemId: number
): Promise<number | null> {
	const row =
		itemType === "seal"
			? await db
					.prepare(
						`SELECT l.id AS lyrics_id FROM lyrics l WHERE l.id = ? AND ${UNDECIDED_LYRIC_JOINED}`
					)
					.bind(itemId)
					.first<{ lyrics_id: number | string }>()
			: await db
					.prepare("SELECT lyrics_id FROM lyric_revisions WHERE id = ? AND status = 'pending'")
					.bind(itemId)
					.first<{ lyrics_id: number | string }>()
	return row ? Number(row.lyrics_id) : null
}

export async function createBookmark(
	env: Env,
	userId: number,
	itemType: BookmarkItemType,
	itemId: number,
	source: CouncilSource
): Promise<BookmarkResult> {
	if (!(await isCommittee(env, userId))) return { ok: false, reason: "not_committee" }
	return env.DB.transaction(async (tx): Promise<BookmarkResult> => {
		const lyricsId = await itemLyricsId(tx, itemType, itemId)
		if (lyricsId === null) return { ok: false, reason: "item_not_found" }
		await advisoryXactLock(tx, `bookmark:${itemType}:${itemId}`)
		await advisoryXactLock(tx, `bookmark-user:${userId}`)
		const [existing] = await queryActive(env, tx, { itemType, itemIds: [itemId] })
		if (existing) {
			if (existing.holder.userId === userId) return { ok: true, bookmark: existing }
			return { ok: false, reason: "held", heldBy: existing }
		}
		const held = await tx
			.prepare(
				`SELECT COUNT(*)::int AS n FROM council_bookmarks b
				 WHERE b.user_id = ? AND b.released_at IS NULL AND b.created_at > ? AND ${HELD_ITEM}`
			)
			.bind(userId, bookmarkActiveSince(now()))
			.first<{ n: number }>()
		if ((held?.n ?? 0) >= config.council.bookmarkCap) return { ok: false, reason: "cap" }
		const inserted = await tx
			.prepare(
				"INSERT INTO council_bookmarks (user_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?) RETURNING id"
			)
			.bind(userId, itemType, itemId, now())
			.first<{ id: number | string }>()
		const bookmarkId = Number(inserted?.id)
		await recordCouncilEvent(tx, {
			actorId: userId,
			kind: "bookmark",
			source,
			lyricsId,
			refId: bookmarkId,
		})
		const [bookmark] = await queryActive(env, tx, { itemType, itemIds: [itemId] })
		return { ok: true, bookmark }
	})
}

export async function releaseBookmark(
	env: Env,
	userId: number,
	bookmarkId: number,
	source: CouncilSource
): Promise<ReleaseResult> {
	return env.DB.transaction(async (tx): Promise<ReleaseResult> => {
		const row = await tx
			.prepare(
				`SELECT b.user_id, b.item_type, b.item_id,
					CASE WHEN b.item_type = 'seal' THEN b.item_id
						ELSE (SELECT r.lyrics_id FROM lyric_revisions r WHERE r.id = b.item_id) END AS lyrics_id
				 FROM council_bookmarks b
				 WHERE b.id = ? AND b.released_at IS NULL AND b.created_at > ?
				 FOR UPDATE`
			)
			.bind(bookmarkId, bookmarkActiveSince(now()))
			.first<{ user_id: number | string; lyrics_id: number | string | null }>()
		if (!row) return { ok: false, reason: "not_found" }
		if (Number(row.user_id) !== userId) return { ok: false, reason: "forbidden" }
		await tx
			.prepare(
				"UPDATE council_bookmarks SET released_at = ?, release_reason = 'released' WHERE id = ?"
			)
			.bind(now(), bookmarkId)
			.run()
		await recordCouncilEvent(tx, {
			actorId: userId,
			kind: "release",
			source,
			lyricsId: row.lyrics_id === null ? null : Number(row.lyrics_id),
			refId: bookmarkId,
		})
		return { ok: true }
	})
}

export async function releaseBookmarksForItem(
	db: D1Compat,
	itemType: BookmarkItemType,
	itemId: number
): Promise<void> {
	await db
		.prepare(
			`UPDATE council_bookmarks SET released_at = ?, release_reason = 'decided'
			 WHERE item_type = ? AND item_id = ? AND released_at IS NULL`
		)
		.bind(now(), itemType, itemId)
		.run()
}
