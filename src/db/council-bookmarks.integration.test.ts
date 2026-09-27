import { config } from "@/config"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture, swapWords } from "@/test/lyric-fixtures"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
	createBookmark,
	listActiveBookmarks,
	releaseBookmark,
	releaseBookmarksForItem,
} from "./council-bookmarks"
import { listCouncilEvents } from "./council-events"

const MIRA = "d1".repeat(32)
const OLA = "d2".repeat(32)
const OUTSIDER = "d3".repeat(32)
const SUBMITTER = "d4".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")
const TTL = config.council.bookmarkTtlSec

describeIntegration("council bookmarks (integration)", () => {
	let db: IntegrationDb
	let mira: number
	let ola: number
	let outsider: number
	let submitter: number
	let lyricIds: number[]

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		mira = await seedCouncilMember(db, MIRA)
		ola = await seedCouncilMember(db, OLA)
		outsider = await seedUser(db, OUTSIDER)
		submitter = await seedUser(db, SUBMITTER)
		lyricIds = []
		for (let i = 0; i < 7; i++) {
			lyricIds.push(
				await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: `dQw4w9WgXc${i}` })
			)
		}
	})

	const events = async () =>
		(await listCouncilEvents(db.env, { includeBookmarks: true, limit: 50 })).events

	async function seedPendingRevision(lyricId: number): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO lyric_revisions (lyrics_id, rev_no, author_id, lyrics, format, sync_type, content_hash, status, pending_reason)
			 VALUES ($1, 99, $2, $3, 'lrc', 'linesync', 'pending-fixture', 'pending', 'sealed')
			 RETURNING id`,
			[lyricId, submitter, swapWords(LRC, 3)]
		)
		return rows[0].id
	}

	async function backdate(bookmarkId: number, secondsAgo: number) {
		await db.pool.query("UPDATE council_bookmarks SET created_at = $1 WHERE id = $2", [
			Math.floor(Date.now() / 1000) - secondsAgo,
			bookmarkId,
		])
	}

	describe("happy paths", () => {
		it("bookmarks a seal candidate and logs it", async () => {
			const result = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.bookmark).toMatchObject({
				itemType: "seal",
				itemId: lyricIds[0],
				lyricsId: lyricIds[0],
				holder: { keyId: MIRA },
			})
			expect(result.bookmark.expiresAt - result.bookmark.createdAt).toBe(TTL)
			const log = await events()
			expect(log).toHaveLength(1)
			expect(log[0]).toMatchObject({ kind: "bookmark", source: "web", actor: { keyId: MIRA } })
		})

		it("bookmarks a pending edit and resolves its lyric", async () => {
			const revisionId = await seedPendingRevision(lyricIds[0])
			const result = await createBookmark(db.env, ola, "edit", revisionId, "web")
			expect(result.ok && result.bookmark.lyricsId).toBe(lyricIds[0])
			const listed = await listActiveBookmarks(db.env, { itemType: "edit" })
			expect(listed.map((b) => b.itemId)).toEqual([revisionId])
		})

		it("releases by the holder and logs the release", async () => {
			const created = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			if (!created.ok) throw new Error("setup")
			expect(await releaseBookmark(db.env, mira, created.bookmark.id, "web")).toEqual({ ok: true })
			expect(await listActiveBookmarks(db.env)).toEqual([])
			expect((await events()).map((e) => e.kind)).toEqual(["release", "bookmark"])
		})

		it("lists active bookmarks filtered by holder and items", async () => {
			await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			await createBookmark(db.env, ola, "seal", lyricIds[1], "discord")
			expect((await listActiveBookmarks(db.env, { userId: ola })).map((b) => b.itemId)).toEqual([
				lyricIds[1],
			])
			expect(
				(await listActiveBookmarks(db.env, { itemType: "seal", itemIds: [lyricIds[0]] })).map(
					(b) => b.holder.keyId
				)
			).toEqual([MIRA])
		})
	})

	describe("error paths", () => {
		it("refuses a non-member", async () => {
			expect(await createBookmark(db.env, outsider, "seal", lyricIds[0], "web")).toEqual({
				ok: false,
				reason: "not_committee",
			})
		})

		it("refuses a missing lyric, a deleted lyric and a decided edit", async () => {
			expect(await createBookmark(db.env, mira, "seal", 987654, "web")).toEqual({
				ok: false,
				reason: "item_not_found",
			})
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2",
				[submitter, lyricIds[0]]
			)
			expect((await createBookmark(db.env, mira, "seal", lyricIds[0], "web")).ok).toBe(false)
			const revisionId = await seedPendingRevision(lyricIds[1])
			await db.pool.query("UPDATE lyric_revisions SET status = 'rejected' WHERE id = $1", [
				revisionId,
			])
			expect(await createBookmark(db.env, mira, "edit", revisionId, "web")).toEqual({
				ok: false,
				reason: "item_not_found",
			})
		})

		it("refuses a lyric that is already sealed or rejected", async () => {
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [
				lyricIds[0],
			])
			expect(await createBookmark(db.env, mira, "seal", lyricIds[0], "web")).toEqual({
				ok: false,
				reason: "item_not_found",
			})
			await db.pool.query(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, 1)",
				[lyricIds[1], ola]
			)
			expect(await createBookmark(db.env, mira, "seal", lyricIds[1], "web")).toEqual({
				ok: false,
				reason: "item_not_found",
			})
		})

		it("reports the holder when someone else holds the item", async () => {
			await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			const result = await createBookmark(db.env, ola, "seal", lyricIds[0], "web")
			expect(result.ok).toBe(false)
			if (result.ok || result.reason !== "held") throw new Error("expected held")
			expect(result.heldBy.holder.keyId).toBe(MIRA)
		})

		it("forbids releasing someone else's bookmark and reports unknown ids", async () => {
			const created = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			if (!created.ok) throw new Error("setup")
			expect(await releaseBookmark(db.env, ola, created.bookmark.id, "web")).toEqual({
				ok: false,
				reason: "forbidden",
			})
			expect(await releaseBookmark(db.env, mira, 424242, "web")).toEqual({
				ok: false,
				reason: "not_found",
			})
		})
	})

	describe("edge cases", () => {
		it("caps active bookmarks per member and frees a slot on release", async () => {
			const held: number[] = []
			for (let i = 0; i < config.council.bookmarkCap; i++) {
				const r = await createBookmark(db.env, mira, "seal", lyricIds[i], "web")
				if (!r.ok) throw new Error(`bookmark ${i} failed`)
				held.push(r.bookmark.id)
			}
			expect(await createBookmark(db.env, mira, "seal", lyricIds[5], "web")).toEqual({
				ok: false,
				reason: "cap",
			})
			await releaseBookmark(db.env, mira, held[0], "web")
			expect((await createBookmark(db.env, mira, "seal", lyricIds[5], "web")).ok).toBe(true)
		})

		it("treats a bookmark older than the TTL as expired", async () => {
			const created = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			if (!created.ok) throw new Error("setup")
			await backdate(created.bookmark.id, TTL)
			expect(await listActiveBookmarks(db.env)).toEqual([])
			expect((await createBookmark(db.env, ola, "seal", lyricIds[0], "web")).ok).toBe(true)
		})

		it("keeps a bookmark one second before the TTL", async () => {
			const created = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			if (!created.ok) throw new Error("setup")
			await backdate(created.bookmark.id, TTL - 1)
			expect(await listActiveBookmarks(db.env)).toHaveLength(1)
		})

		it("does not count expired bookmarks toward the cap", async () => {
			for (let i = 0; i < config.council.bookmarkCap; i++) {
				const r = await createBookmark(db.env, mira, "seal", lyricIds[i], "web")
				if (r.ok) await backdate(r.bookmark.id, TTL + 60)
			}
			expect((await createBookmark(db.env, mira, "seal", lyricIds[5], "web")).ok).toBe(true)
		})
	})

	describe("invariants", () => {
		it("re-bookmarking your own item is idempotent and logs once", async () => {
			const a = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			const b = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			expect(a.ok && b.ok && a.bookmark.id === b.bookmark.id).toBe(true)
			expect(await events()).toHaveLength(1)
		})

		it("releasing for a decided item marks it decided without logging", async () => {
			await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			await releaseBookmarksForItem(db.env.DB, "seal", lyricIds[0])
			const { rows } = await db.pool.query("SELECT release_reason FROM council_bookmarks")
			expect(rows[0].release_reason).toBe("decided")
			expect((await events()).map((e) => e.kind)).toEqual(["bookmark"])
		})

		it("a seal bookmark and an edit bookmark on one lyric are independent", async () => {
			const revisionId = await seedPendingRevision(lyricIds[0])
			expect((await createBookmark(db.env, mira, "seal", lyricIds[0], "web")).ok).toBe(true)
			expect((await createBookmark(db.env, ola, "edit", revisionId, "web")).ok).toBe(true)
			expect(await listActiveBookmarks(db.env)).toHaveLength(2)
		})
	})

	describe("regressions", () => {
		it("regression: a bookmark on an item that left the queue without a decision stops counting", async () => {
			const sealed = await createBookmark(db.env, mira, "seal", lyricIds[0], "web")
			const deleted = await createBookmark(db.env, mira, "seal", lyricIds[1], "web")
			const rejected = await createBookmark(db.env, mira, "seal", lyricIds[2], "web")
			const revisionId = await seedPendingRevision(lyricIds[3])
			const withdrawn = await createBookmark(db.env, mira, "edit", revisionId, "web")
			const kept = await createBookmark(db.env, mira, "seal", lyricIds[4], "web")
			if (!sealed.ok || !deleted.ok || !rejected.ok || !withdrawn.ok || !kept.ok)
				throw new Error("setup")
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [
				lyricIds[0],
			])
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2",
				[submitter, lyricIds[1]]
			)
			await db.pool.query(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, 1)",
				[lyricIds[2], ola]
			)
			await db.pool.query("UPDATE lyric_revisions SET status = 'withdrawn' WHERE id = $1", [
				revisionId,
			])
			const active = await listActiveBookmarks(db.env, { userId: mira })
			expect(active.map((b) => b.id)).toEqual([kept.bookmark.id])
			expect((await createBookmark(db.env, mira, "seal", lyricIds[5], "web")).ok).toBe(true)
		})

		it("regression: a removed member's bookmarks no longer hold items", async () => {
			const held = await createBookmark(db.env, ola, "seal", lyricIds[0], "web")
			if (!held.ok) throw new Error("setup")
			await db.pool.query("DELETE FROM committee_members WHERE user_id = $1", [ola])
			expect(
				await listActiveBookmarks(db.env, { itemType: "seal", itemIds: [lyricIds[0]] })
			).toEqual([])
			expect((await createBookmark(db.env, mira, "seal", lyricIds[0], "web")).ok).toBe(true)
		})

		it("regression: two members racing for one item yields exactly one holder", async () => {
			const results = await Promise.all([
				createBookmark(db.env, mira, "seal", lyricIds[0], "web"),
				createBookmark(db.env, ola, "seal", lyricIds[0], "web"),
			])
			expect(results.filter((r) => r.ok)).toHaveLength(1)
			expect(await listActiveBookmarks(db.env)).toHaveLength(1)
		})
	})
})
