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
import { readRevisionFixture } from "@/test/lyric-fixtures"
import type { MetadataInput } from "@/utils/metadata-input"
import { normalizeAlbum, normalizeArtist, normalizeSong } from "@/utils/normalize"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { approvedMetadata } from "./approved-metadata"
import { castVote, createProposal, listOpenProposals } from "./metadata-proposals"

const VIDEO = "HsBfV2A5dUY"
const OTHER_VIDEO = "dQw4w9WgXcQ"
const LRC = readRevisionFixture("amazing-grace.lrc")
const kid = (n: number): string => n.toString(16).padStart(64, "0")

const PROPOSED: MetadataInput = {
	videoId: VIDEO,
	song: "Amazing Grace (My Chains Are Gone)",
	artist: "Chris Tomlin",
	album: "See the Morning",
}

describeIntegration("metadata proposals (integration)", () => {
	let db: IntegrationDb
	let submitter: number
	let proposer: number
	let second: number
	let third: number
	let fourth: number
	let outsider: number

	const rows = async (videoId = VIDEO) =>
		(
			await db.pool.query<{
				id: number
				song: string
				artist: string
				album: string | null
				song_norm: string
				artist_norm: string
				album_norm: string | null
			}>(
				"SELECT id, song, artist, album, song_norm, artist_norm, album_norm FROM lyrics WHERE video_id = $1 ORDER BY id",
				[videoId]
			)
		).rows

	const proposal = async (id: number) =>
		(
			await db.pool.query<{ status: string; decided_at: number | null }>(
				"SELECT status, decided_at FROM metadata_proposals WHERE id = $1",
				[id]
			)
		).rows[0]

	const events = async (id: number) =>
		(
			await db.pool.query<{ kind: string; actor_id: number; note: string | null }>(
				"SELECT kind, actor_id, note FROM council_events WHERE ref_id = $1 AND kind LIKE 'metadata_%' ORDER BY id",
				[id]
			)
		).rows

	const propose = async (input: MetadataInput = PROPOSED) => {
		const result = await createProposal(db.env, proposer, input)
		if (!result.ok) throw new Error(`proposal failed: ${result.reason}`)
		return result.id
	}

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		submitter = await seedUser(db, kid(1))
		proposer = await seedCouncilMember(db, kid(2))
		second = await seedCouncilMember(db, kid(3))
		third = await seedCouncilMember(db, kid(4))
		fourth = await seedCouncilMember(db, kid(5))
		outsider = await seedUser(db, kid(6))
		await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
	})

	describe("createProposal", () => {
		it("opens a proposal with the current values and the proposer's approval", async () => {
			const id = await propose()
			const stored = await db.pool.query(
				"SELECT video_id, song, artist, album, before_song, before_artist, before_album, status FROM metadata_proposals WHERE id = $1",
				[id]
			)
			expect(stored.rows[0]).toEqual({
				video_id: VIDEO,
				song: PROPOSED.song,
				artist: PROPOSED.artist,
				album: PROPOSED.album,
				before_song: "Amazing Grace",
				before_artist: "Traditional",
				before_album: null,
				status: "open",
			})
			const votes = await db.pool.query(
				"SELECT voter_id, approve FROM metadata_votes WHERE proposal_id = $1",
				[id]
			)
			expect(votes.rows).toEqual([{ voter_id: proposer, approve: true }])
			expect(await events(id)).toEqual([
				{ kind: "metadata_propose", actor_id: proposer, note: null },
			])
		})

		it("refuses a proposal that changes nothing", async () => {
			const result = await createProposal(db.env, proposer, {
				videoId: VIDEO,
				song: "Amazing Grace",
				artist: "Traditional",
				album: null,
			})
			expect(result).toEqual({ ok: false, reason: "no_changes" })
		})

		it("refuses a video with no live lyric", async () => {
			const result = await createProposal(db.env, proposer, { ...PROPOSED, videoId: OTHER_VIDEO })
			expect(result).toEqual({ ok: false, reason: "not_found" })
		})

		it("refuses a second open proposal for the same video", async () => {
			await propose()
			const result = await createProposal(db.env, second, { ...PROPOSED, artist: "Someone" })
			expect(result).toEqual({ ok: false, reason: "open" })
		})

		it("refuses a user who is not on the council", async () => {
			const result = await createProposal(db.env, outsider, PROPOSED)
			expect(result).toEqual({ ok: false, reason: "not_committee" })
		})

		it("allows a new proposal once the previous one closed", async () => {
			const first = await propose()
			await castVote(db.env, first, second, false, null)
			const again = await createProposal(db.env, second, PROPOSED)
			expect(again.ok).toBe(true)
		})
	})

	describe("castVote", () => {
		it("keeps the proposal open below the quorum", async () => {
			const id = await propose()
			const result = await castVote(db.env, id, second, true, null)
			expect(result).toEqual({ ok: true, status: "open", approvals: 2 })
			expect((await proposal(id)).status).toBe("open")
			expect((await rows())[0].song).toBe("Amazing Grace")
		})

		it("rewrites every variant of the video at the quorum", async () => {
			const otherSubmitter = await seedUser(db, kid(7))
			await seedLyric(db, otherSubmitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
			const deletedSubmitter = await seedUser(db, kid(8))
			const deleted = await seedLyric(db, deletedSubmitter, {
				lyrics: LRC,
				format: "lrc",
				videoId: VIDEO,
			})
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
				[deleted, deletedSubmitter]
			)
			const untouched = await seedLyric(db, submitter, {
				lyrics: LRC,
				format: "lrc",
				videoId: OTHER_VIDEO,
			})

			const id = await propose()
			await castVote(db.env, id, second, true, null)
			const result = await castVote(db.env, id, third, true, null)

			const variants = await rows()
			expect(variants).toHaveLength(3)
			expect(result).toEqual({
				ok: true,
				status: "passed",
				lyricIds: expect.arrayContaining(variants.map((r) => r.id)),
			})
			if (result.ok && result.status === "passed") expect(result.lyricIds).toHaveLength(3)
			for (const row of variants) {
				expect(row).toMatchObject({
					song: PROPOSED.song,
					artist: PROPOSED.artist,
					album: PROPOSED.album,
					song_norm: normalizeSong(PROPOSED.song),
					artist_norm: normalizeArtist(PROPOSED.artist),
					album_norm: normalizeAlbum(PROPOSED.album),
				})
			}
			const stored = await proposal(id)
			expect(stored.status).toBe("passed")
			expect(stored.decided_at).not.toBeNull()
			expect((await rows(OTHER_VIDEO)).find((r) => r.id === untouched)?.song).toBe("Amazing Grace")
		})

		it("clears the album when the proposal removes it", async () => {
			await db.pool.query(
				"UPDATE lyrics SET album = 'Old', album_norm = 'old' WHERE video_id = $1",
				[VIDEO]
			)
			const id = await propose({ ...PROPOSED, album: null })
			await castVote(db.env, id, second, true, null)
			await castVote(db.env, id, third, true, null)
			expect((await rows())[0]).toMatchObject({ album: null, album_norm: null })
		})

		it("closes the proposal on one reject without touching rows", async () => {
			const id = await propose()
			await castVote(db.env, id, second, true, null)
			const result = await castVote(db.env, id, third, false, "wrong artist")
			expect(result).toEqual({ ok: true, status: "rejected" })
			expect((await proposal(id)).status).toBe("rejected")
			expect((await rows())[0].song).toBe("Amazing Grace")
		})

		it("lets the proposer close their own proposal", async () => {
			const id = await propose()
			const result = await castVote(db.env, id, proposer, false, null)
			expect(result).toEqual({ ok: true, status: "rejected" })
		})

		it("refuses votes on a closed proposal", async () => {
			const id = await propose()
			await castVote(db.env, id, second, false, null)
			expect(await castVote(db.env, id, third, true, null)).toEqual({
				ok: false,
				reason: "already_decided",
			})
		})

		it("refuses an unknown proposal", async () => {
			expect(await castVote(db.env, 999_999, second, true, null)).toEqual({
				ok: false,
				reason: "not_found",
			})
		})

		it("refuses a user who is not on the council", async () => {
			const id = await propose()
			expect(await castVote(db.env, id, outsider, true, null)).toEqual({
				ok: false,
				reason: "not_committee",
			})
		})

		it("records one event per vote with the reject note", async () => {
			const id = await propose()
			await castVote(db.env, id, second, true, null)
			await castVote(db.env, id, third, false, "wrong artist")
			expect(await events(id)).toEqual([
				{ kind: "metadata_propose", actor_id: proposer, note: null },
				{ kind: "metadata_approve", actor_id: second, note: null },
				{ kind: "metadata_reject", actor_id: third, note: "wrong artist" },
			])
		})
	})

	describe("invariants", () => {
		it("counts a repeated approval once", async () => {
			const id = await propose()
			await castVote(db.env, id, second, true, null)
			const again = await castVote(db.env, id, second, true, null)
			expect(again).toEqual({ ok: true, status: "open", approvals: 2 })
			expect(await events(id)).toHaveLength(2)
		})

		it("never lets the proposer's own repeated approval reach the quorum", async () => {
			const id = await propose()
			for (let i = 0; i < config.council.metadataApprovals; i++) {
				await castVote(db.env, id, proposer, true, null)
			}
			expect((await proposal(id)).status).toBe("open")
		})
	})

	describe("regressions", () => {
		it("regression: two final approvals at once rewrite the rows once", async () => {
			const id = await propose()
			await castVote(db.env, id, second, true, null)
			const results = await Promise.all([
				castVote(db.env, id, third, true, null),
				castVote(db.env, id, fourth, true, null),
			])
			const passed = results.filter((r) => r.ok && r.status === "passed")
			const late = results.filter((r) => !r.ok)
			expect(passed).toHaveLength(1)
			expect(late).toEqual([{ ok: false, reason: "already_decided" }])
			expect((await proposal(id)).status).toBe("passed")
		})
	})

	describe("approvedMetadata", () => {
		it("returns null when nothing passed", async () => {
			const id = await propose()
			expect(await approvedMetadata(db.env, VIDEO)).toBeNull()
			await castVote(db.env, id, second, false, null)
			expect(await approvedMetadata(db.env, VIDEO)).toBeNull()
		})

		it("returns the newest passed proposal", async () => {
			const first = await propose({ ...PROPOSED, song: "First" })
			await castVote(db.env, first, second, true, null)
			await castVote(db.env, first, third, true, null)
			const next = await propose({ ...PROPOSED, song: "Second", album: null })
			await castVote(db.env, next, second, true, null)
			await castVote(db.env, next, third, true, null)
			expect(await approvedMetadata(db.env, VIDEO)).toEqual({
				song: "Second",
				artist: PROPOSED.artist,
				album: null,
			})
		})
	})

	describe("new variants after a pass", () => {
		it("take the approved details instead of the submitted ones", async () => {
			const id = await propose()
			await castVote(db.env, id, second, true, null)
			await castVote(db.env, id, third, true, null)
			const later = await seedUser(db, kid(9))
			const created = await seedLyric(db, later, { lyrics: LRC, format: "lrc", videoId: VIDEO })
			expect((await rows()).find((r) => r.id === created)).toMatchObject({
				song: PROPOSED.song,
				artist: PROPOSED.artist,
				album: PROPOSED.album,
				song_norm: normalizeSong(PROPOSED.song),
				artist_norm: normalizeArtist(PROPOSED.artist),
				album_norm: normalizeAlbum(PROPOSED.album),
			})
		})

		it("keep the submitted details when nothing passed", async () => {
			const id = await propose()
			await castVote(db.env, id, second, false, null)
			const later = await seedUser(db, kid(9))
			const created = await seedLyric(db, later, {
				lyrics: LRC,
				format: "lrc",
				videoId: VIDEO,
				album: "Hymns",
			})
			expect((await rows()).find((r) => r.id === created)).toMatchObject({
				song: "Amazing Grace",
				artist: "Traditional",
				album: "Hymns",
			})
		})
	})

	describe("listOpenProposals", () => {
		it("lists only open proposals with their approvers", async () => {
			await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: OTHER_VIDEO })
			const open = await propose()
			await castVote(db.env, open, second, true, null)
			const closed = await propose({ ...PROPOSED, videoId: OTHER_VIDEO })
			await castVote(db.env, closed, third, false, null)

			const list = await listOpenProposals(db.env)
			expect(list).toHaveLength(1)
			expect(list[0]).toMatchObject({
				id: open,
				videoId: VIDEO,
				proposerId: proposer,
				proposed: { song: PROPOSED.song, artist: PROPOSED.artist, album: PROPOSED.album },
				before: { song: "Amazing Grace", artist: "Traditional", album: null },
				approverIds: [proposer, second],
			})
		})

		it("returns an empty list when nothing is open", async () => {
			expect(await listOpenProposals(db.env)).toEqual([])
		})
	})
})
