import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getSealCandidates, rejectLyric, undoRejection } from "./rejections"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const kid = (n: number): string => n.toString(16).padStart(64, "0")
const NOW = Math.floor(Date.now() / 1000)

describeIntegration("rejections store (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let userSeq = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = { DB: new D1Compat(pool) } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM rejections")
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM users")
	}

	function newUser(nickname: string | null = null): Promise<number> {
		userSeq++
		return insertUser(kid(userSeq), nickname)
	}

	async function insertUser(keyId: string, nickname: string | null): Promise<number> {
		const row = await one<{ id: number }>(
			"INSERT INTO users (key_id, nickname) VALUES ($1, $2) RETURNING id",
			[keyId, nickname]
		)
		return row.id
	}

	async function addToCommittee(userId: number): Promise<void> {
		await pool.query("INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')", [
			userId,
		])
	}

	interface LyricOpts {
		videoId: string
		submitterId?: number | null
		effectiveScore?: number
		voteCount?: number
		downvotes?: number
		score?: number
		committeeApprovedAt?: number | null
		deletedById?: number | null
		createdAt?: number
		syncType?: string
		format?: string
		lyrics?: string
	}

	async function insertLyric(opts: LyricOpts): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, effective_score, vote_count, downvotes, score, committee_approved_at,
				 deleted_at, deleted_by_user_id, deleted_by_role, created_at)
			 VALUES ($1,'Song','Artist',180,'song','artist',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			 RETURNING id`,
			[
				opts.videoId,
				opts.lyrics ?? "gz",
				opts.format ?? "lrc",
				opts.syncType ?? "linesync",
				opts.submitterId ?? null,
				opts.effectiveScore ?? 1,
				opts.voteCount ?? 1,
				opts.downvotes ?? 0,
				opts.score ?? 1,
				opts.committeeApprovedAt ?? null,
				opts.deletedById != null ? NOW : null,
				opts.deletedById ?? null,
				opts.deletedById != null ? "admin" : null,
				opts.createdAt ?? NOW,
			]
		)
		return row.id
	}

	async function activeRejection(
		lyricsId: number
	): Promise<{ rejected_by: number; note: string | null; revoked_at: number | null } | undefined> {
		return one(
			"SELECT rejected_by, note, revoked_at FROM rejections WHERE lyrics_id = $1 AND revoked_at IS NULL",
			[lyricsId]
		)
	}

	beforeEach(wipe)

	describe("getSealCandidates", () => {
		it("returns an eligible candidate with submitter display info", async () => {
			const submitter = await newUser("Nick")
			const id = await insertLyric({
				videoId: "vidA",
				submitterId: submitter,
				score: 7,
				voteCount: 4,
			})

			const rows = await getSealCandidates(env, { limit: 10, sort: "top-rated" })

			expect(rows).toHaveLength(1)
			const submitterKey = await one<{ key_id: string }>("SELECT key_id FROM users WHERE id = $1", [
				submitter,
			])
			expect(rows[0]).toMatchObject({
				id,
				video_id: "vidA",
				song: "Song",
				artist: "Artist",
				score: 7,
				vote_count: 4,
				submitter_nickname: "Nick",
			})
			expect(rows[0].submitter_key_id).toBe(submitterKey.key_id)
		})

		it("excludes sealed, deleted, non-positive-score, and actively-rejected lyrics", async () => {
			const u = await newUser()
			await insertLyric({ videoId: "vSealed", committeeApprovedAt: NOW })
			await insertLyric({ videoId: "vDeleted", deletedById: u })
			await insertLyric({ videoId: "vZero", effectiveScore: 0 })
			await insertLyric({ videoId: "vNeg", effectiveScore: -1 })
			const rejected = await insertLyric({ videoId: "vRejected" })
			const reviewer = await newUser()
			await addToCommittee(reviewer)
			await rejectLyric(env, rejected, reviewer)

			const keep = await insertLyric({ videoId: "vKeep" })
			const rows = await getSealCandidates(env, { limit: 25, sort: "top-rated" })

			expect(rows.map((r) => r.id)).toEqual([keep])
		})

		it("excludes an auto-hidden (decisively downvoted) lyric even with positive stored score", async () => {
			await insertLyric({
				videoId: "vHidden",
				effectiveScore: 0.9,
				voteCount: 2,
				downvotes: 2,
				createdAt: NOW - 4 * 86400,
			})
			const rows = await getSealCandidates(env, { limit: 10, sort: "top-rated" })
			expect(rows).toHaveLength(0)
		})

		it("dedups to one best variant per video_id", async () => {
			await insertLyric({ videoId: "dupe", effectiveScore: 0.2, score: 1 })
			const best = await insertLyric({ videoId: "dupe", effectiveScore: 0.9, score: 9 })

			const rows = await getSealCandidates(env, { limit: 10, sort: "top-rated" })
			expect(rows).toHaveLength(1)
			expect(rows[0].id).toBe(best)
		})

		it("orders by effective_score for top-rated and vote_count for most-voted", async () => {
			await insertLyric({ videoId: "hiScore", effectiveScore: 0.9, voteCount: 2 })
			await insertLyric({ videoId: "hiVotes", effectiveScore: 0.4, voteCount: 50 })

			const topRated = await getSealCandidates(env, { limit: 10, sort: "top-rated" })
			expect(topRated.map((r) => r.video_id)).toEqual(["hiScore", "hiVotes"])

			const mostVoted = await getSealCandidates(env, { limit: 10, sort: "most-voted" })
			expect(mostVoted.map((r) => r.video_id)).toEqual(["hiVotes", "hiScore"])
		})

		it("respects the limit", async () => {
			for (let i = 0; i < 5; i++)
				await insertLyric({ videoId: `lim${i}`, effectiveScore: i / 10 + 0.1 })
			const rows = await getSealCandidates(env, { limit: 2, sort: "top-rated" })
			expect(rows).toHaveLength(2)
		})

		it("returns [] when nothing is eligible", async () => {
			expect(await getSealCandidates(env, { limit: 10, sort: "top-rated" })).toEqual([])
		})

		it("returns a candidate with a null submitter", async () => {
			await insertLyric({ videoId: "orphan", submitterId: null })
			const rows = await getSealCandidates(env, { limit: 10, sort: "top-rated" })
			expect(rows[0].submitter_key_id).toBeNull()
			expect(rows[0].submitter_nickname).toBeNull()
		})
	})

	describe("rejectLyric", () => {
		it("not_committee when the reviewer is not on the roster", async () => {
			const reviewer = await newUser()
			const id = await insertLyric({ videoId: "vNC" })
			expect(await rejectLyric(env, id, reviewer)).toEqual({ ok: false, reason: "not_committee" })
		})

		it("lyric_not_found for a bogus lyrics id", async () => {
			const reviewer = await newUser()
			await addToCommittee(reviewer)
			expect(await rejectLyric(env, 999999, reviewer)).toEqual({
				ok: false,
				reason: "lyric_not_found",
			})
		})

		it("records a rejection with the reviewer and note", async () => {
			const reviewer = await newUser()
			await addToCommittee(reviewer)
			const id = await insertLyric({ videoId: "vRej" })

			expect(await rejectLyric(env, id, reviewer, "bad sync")).toEqual({ ok: true })
			expect(await activeRejection(id)).toMatchObject({ rejected_by: reviewer, note: "bad sync" })
		})

		it("already_rejected when an active rejection exists", async () => {
			const reviewer = await newUser()
			await addToCommittee(reviewer)
			const id = await insertLyric({ videoId: "vDup" })
			await rejectLyric(env, id, reviewer)
			expect(await rejectLyric(env, id, reviewer)).toEqual({
				ok: false,
				reason: "already_rejected",
			})
		})
	})

	describe("undoRejection", () => {
		it("not_committee when the actor is not on the roster", async () => {
			const actor = await newUser()
			const id = await insertLyric({ videoId: "vU" })
			expect(await undoRejection(env, id, actor)).toEqual({ ok: false, reason: "not_committee" })
		})

		it("not_found when there is no active rejection", async () => {
			const actor = await newUser()
			await addToCommittee(actor)
			const id = await insertLyric({ videoId: "vNone" })
			expect(await undoRejection(env, id, actor)).toEqual({ ok: false, reason: "not_found" })
		})

		it("revokes the active rejection and lets any council member undo", async () => {
			const rejecter = await newUser()
			await addToCommittee(rejecter)
			const other = await newUser()
			await addToCommittee(other)
			const id = await insertLyric({ videoId: "vUndo" })
			await rejectLyric(env, id, rejecter)

			expect(await undoRejection(env, id, other)).toEqual({ ok: true })
			expect(await activeRejection(id)).toBeUndefined()
		})

		it("allows re-rejection after an undo and keeps the old row as a log", async () => {
			const reviewer = await newUser()
			await addToCommittee(reviewer)
			const id = await insertLyric({ videoId: "vReRej" })
			await rejectLyric(env, id, reviewer)
			await undoRejection(env, id, reviewer)

			expect(await rejectLyric(env, id, reviewer)).toEqual({ ok: true })
			const count = await one<{ n: string }>(
				"SELECT COUNT(*) AS n FROM rejections WHERE lyrics_id = $1",
				[id]
			)
			expect(Number(count.n)).toBe(2)
		})
	})
})
