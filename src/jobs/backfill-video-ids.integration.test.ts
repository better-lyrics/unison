import { findByVideoId, submitLyrics } from "@/db/lyrics"
import { backfillVideoIds } from "@/jobs/backfill-video-ids"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import type { LyricsSubmission } from "@/types"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const SUBMISSION: LyricsSubmission = {
	videoId: "9yfrVqCcrS0",
	song: "Sesi Potret",
	artist: "eńau, Ari Lesmana",
	duration: 214,
	lyrics: "[00:01.00] satu dua tiga\n[00:05.00] senyum di depan kamera",
	format: "lrc",
	syncType: "linesync",
	language: "id",
}

describeIntegration("backfillVideoIds (integration)", () => {
	let db: IntegrationDb
	let submitter: number

	const seed = async (videoId: string) =>
		(await submitLyrics(db.env, { ...SUBMISSION, videoId }, submitter)).id

	const row = async (id: number) =>
		(
			await db.pool.query(
				`SELECT video_id, deleted_at IS NOT NULL AS deleted, deleted_by_role, deletion_reason,
					reputation_penalized FROM lyrics WHERE id = $1`,
				[id]
			)
		).rows[0]

	const links = async (id: number) =>
		(
			await db.pool.query(
				"SELECT video_id FROM lyrics_video_ids WHERE lyrics_id = $1 ORDER BY video_id",
				[id]
			)
		).rows.map((r) => r.video_id)

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.query("DELETE FROM lyrics_video_ids")
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM lyrics_video_ids")
		await wipeRevisionData(db)
		submitter = await seedUser(db, "backfill-video-ids")
	})

	describe("repairs", () => {
		it("rewrites a pasted link to its video id and moves the home link", async () => {
			const id = await seed("https://music.youtube.com/watch?v=9yfrVqCcrS0&si=cQ3SU5WVYjJvKbhq")

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 1, deleted: 0 })

			expect((await row(id)).video_id).toBe("9yfrVqCcrS0")
			expect(await links(id)).toEqual(["9yfrVqCcrS0"])
			expect((await findByVideoId(db.env, "9yfrVqCcrS0"))?.id).toBe(id)
		})

		it("rewrites a pasted fragment of a link", async () => {
			const id = await seed("8ylRSepPra4&si")

			await backfillVideoIds(db.env)

			expect((await row(id)).video_id).toBe("8ylRSepPra4")
		})

		it("evicts the cached lookup for the repaired video", async () => {
			const id = await seed("https://youtu.be/9yfrVqCcrS0?si=abc")
			await db.cache.put("v:9yfrVqCcrS0", "stale")

			await backfillVideoIds(db.env)

			expect(db.cache.store.has("v:9yfrVqCcrS0")).toBe(false)
			expect((await row(id)).video_id).toBe("9yfrVqCcrS0")
		})
	})

	describe("deletions", () => {
		it("regression: soft-deletes a lyric whose video id cannot be recovered, without a penalty", async () => {
			const reputation = async () =>
				(await db.pool.query("SELECT reputation FROM users WHERE id = $1", [submitter])).rows[0]
					.reputation
			const before = await reputation()
			const ids = [await seed("local-file"), await seed("e.d  rt"), await seed("t7AcyLcqkIWx6a23")]

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 0, deleted: 3 })

			for (const id of ids) {
				expect(await row(id)).toMatchObject({
					deleted: true,
					deleted_by_role: "system",
					deletion_reason: "invalid video id",
					reputation_penalized: false,
				})
			}
			expect(await reputation()).toBe(before)
		})
	})

	describe("edge cases", () => {
		it("keeps the repaired lyric when it already links the recovered id", async () => {
			const id = await seed("v=9yfrVqCcrS0")
			await db.pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, '9yfrVqCcrS0')",
				[id]
			)

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 1, deleted: 0 })

			expect(await links(id)).toEqual(["9yfrVqCcrS0"])
		})

		it("regression: drops every invalid link row of a repaired lyric, not only the old home id", async () => {
			const id = await seed("https://youtu.be/9yfrVqCcrS0")
			await db.pool.query(
				"INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1, 'local-file'), ($1, 'dQw4w9WgXcQ')",
				[id]
			)

			await backfillVideoIds(db.env)

			expect(await links(id)).toEqual(["9yfrVqCcrS0", "dQw4w9WgXcQ"])
		})

		it("skips a lyric with no submitter instead of deleting it", async () => {
			const id = await seed("local-file")
			await db.pool.query("UPDATE lyrics SET submitter_id = NULL WHERE id = $1", [id])

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 0, deleted: 0 })

			expect(await row(id)).toMatchObject({ deleted: false, video_id: "local-file" })
		})

		it("leaves valid and already deleted lyrics alone", async () => {
			const valid = await seed("dQw4w9WgXcQ")
			const gone = await seed("local-file")
			await db.pool.query(
				`UPDATE lyrics SET deleted_at = 1700000000, deleted_by_user_id = $2,
					deleted_by_role = 'submitter' WHERE id = $1`,
				[gone, submitter]
			)

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 0, deleted: 0 })

			expect(await row(valid)).toMatchObject({ video_id: "dQw4w9WgXcQ", deleted: false })
			expect(await row(gone)).toMatchObject({
				video_id: "local-file",
				deleted_by_role: "submitter",
			})
		})
	})

	describe("invariants", () => {
		it("is idempotent", async () => {
			await seed("https://youtu.be/9yfrVqCcrS0")
			await seed("local-file")

			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 1, deleted: 1 })
			expect(await backfillVideoIds(db.env)).toEqual({ repaired: 0, deleted: 0 })
		})
	})
})
