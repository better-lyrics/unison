import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import { wipeCouncilTables } from "@/test/integration-harness"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createBoost, getQuota, monthWindow, revokeBoost, revokeBoostByAdmin } from "./boost"
import { createBookmark, listActiveBookmarks } from "./council-bookmarks"
import { listCouncilEvents } from "./council-events"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const kid = (n: number): string => n.toString(16).padStart(64, "0")

describeIntegration("boost store (integration)", () => {
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
		const cache = {
			store: new Map<string, string>(),
			async get(key: string) {
				return this.store.get(key) ?? null
			},
			async put(key: string, value: string) {
				this.store.set(key, value)
			},
			async delete(key: string) {
				this.store.delete(key)
			},
		}
		env = { DB: new D1Compat(pool), CACHE: cache } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM badge_awards")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM contribution_events")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await wipeCouncilTables(pool)
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function insertUser(keyId: string, reputation = 1.0): Promise<number> {
		const row = await one<{ id: number }>(
			"INSERT INTO users (key_id, reputation) VALUES ($1, $2) RETURNING id",
			[keyId, reputation]
		)
		return row.id
	}

	async function addToCommittee(userId: number): Promise<void> {
		await pool.query("INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')", [
			userId,
		])
	}

	const { lastMonthStart, monthStart } = monthWindow()
	const lastMonth = lastMonthStart + 3600

	async function addVeteran(userId: number): Promise<void> {
		await pool.query(
			"INSERT INTO committee_members (user_id, added_by, added_at) VALUES ($1, 'test', $2)",
			[userId, lastMonthStart - 86400]
		)
	}

	async function insertOwnLyric(
		submitterId: number,
		videoId: string,
		row: { createdAt: number; effectiveScore?: number; voteCount?: number; downvotes?: number }
	): Promise<number> {
		const id = await insertLyric(submitterId, videoId)
		await pool.query(
			"UPDATE lyrics SET created_at = $2, effective_score = $3, vote_count = $4, downvotes = $5 WHERE id = $1",
			[id, row.createdAt, row.effectiveScore ?? 0, row.voteCount ?? 0, row.downvotes ?? 0]
		)
		return id
	}

	async function insertLyric(submitterId: number | null, videoId: string): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, submitter_id)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', $2) RETURNING id`,
			[videoId, submitterId]
		)
		return row.id
	}

	function newUser(reputation = 1.0): Promise<number> {
		userSeq++
		return insertUser(kid(userSeq), reputation)
	}

	async function activeBoostRow(
		lyricsId: number
	): Promise<{ id: number; booster_id: number; revoked_at: number | null } | undefined> {
		return one("SELECT id, booster_id, revoked_at FROM boosts WHERE lyrics_id = $1", [lyricsId])
	}

	async function lyricMirror(
		lyricsId: number
	): Promise<{ committee_approved_at: number | null; committee_approved_by: number | null }> {
		return one("SELECT committee_approved_at, committee_approved_by FROM lyrics WHERE id = $1", [
			lyricsId,
		])
	}

	beforeEach(wipe)

	describe("rejections", () => {
		it("not_committee when the booster is not on the roster", async () => {
			const booster = await newUser()
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidNC")
			const result = await createBoost(env, booster, lyricsId, "web")
			expect(result).toEqual({ ok: false, reason: "not_committee" })
		})

		it("lyric_not_found for a bogus lyrics id", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const result = await createBoost(env, booster, 999999, "web")
			expect(result).toEqual({ ok: false, reason: "lyric_not_found" })
		})

		it("self when the booster submitted the lyric", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(booster, "vidSelf")
			const result = await createBoost(env, booster, lyricsId, "web")
			expect(result).toEqual({ ok: false, reason: "self" })
		})

		it("target_committee when the lyric was submitted by another council member", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const otherCommittee = await newUser()
			await addToCommittee(otherCommittee)
			const lyricsId = await insertLyric(otherCommittee, "vidTC")
			const result = await createBoost(env, booster, lyricsId, "web")
			expect(result).toEqual({ ok: false, reason: "target_committee" })
		})

		it("already_boosted when the lyric already has an active boost", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAB")
			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
			const result = await createBoost(env, booster, lyricsId, "web")
			expect(result).toEqual({ ok: false, reason: "already_boosted" })
		})

		it("over_quota once an inactive member spends the inactive quota", async () => {
			const booster = await newUser()
			await addVeteran(booster)
			const submitter = await newUser()
			const ids = await Promise.all(
				["vidQ1", "vidQ2", "vidQ3", "vidQ4"].map((v) => insertLyric(submitter, v))
			)
			for (const id of ids.slice(0, 3)) {
				expect((await createBoost(env, booster, id, "web")).ok).toBe(true)
			}
			const result = await createBoost(env, booster, ids[3], "web")
			expect(result).toEqual({ ok: false, reason: "over_quota" })
		})

		it("rejected when the lyric has an active council rejection", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidRej")
			await pool.query(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, 1)",
				[lyricsId, booster]
			)

			expect(await createBoost(env, booster, lyricsId, "web")).toEqual({
				ok: false,
				reason: "rejected",
			})
			expect(await activeBoostRow(lyricsId)).toBeUndefined()
			expect((await lyricMirror(lyricsId)).committee_approved_at).toBeNull()
		})

		it("seals once the rejection is undone", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidUndone")
			await pool.query(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at, revoked_at) VALUES ($1, $2, 1, 2)",
				[lyricsId, booster]
			)

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
		})
	})

	describe("happy path", () => {
		it("records the boost and mirrors approval onto the lyric", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidHappy")

			const result = await createBoost(env, booster, lyricsId, "web")
			expect(result.ok).toBe(true)

			const boost = await activeBoostRow(lyricsId)
			expect(boost).toBeDefined()
			expect(boost?.revoked_at).toBeNull()
			expect(Number(boost?.booster_id)).toBe(booster)

			const mirror = await lyricMirror(lyricsId)
			expect(mirror.committee_approved_at).not.toBeNull()
			expect(mirror.committee_approved_by).toBe(booster)
		})
	})

	describe("revoke", () => {
		it("frees the slot and clears the mirror, then allows a fresh boost", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidRevoke")

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
			expect(await revokeBoost(env, booster, lyricsId, "web")).toEqual({ ok: true })

			const mirror = await lyricMirror(lyricsId)
			expect(mirror.committee_approved_at).toBeNull()
			expect(mirror.committee_approved_by).toBeNull()

			const revoked = await one<{ revoked_at: number | null }>(
				"SELECT revoked_at FROM boosts WHERE lyrics_id = $1 ORDER BY id DESC LIMIT 1",
				[lyricsId]
			)
			expect(revoked.revoked_at).not.toBeNull()

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
		})

		it("forbidden when a non-booster tries to revoke", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const other = await newUser()
			await addToCommittee(other)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidForbidden")

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
			expect(await revokeBoost(env, other, lyricsId, "web")).toEqual({
				ok: false,
				reason: "forbidden",
			})
		})

		it("not_found when there is no active boost to revoke", async () => {
			const actor = await newUser()
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidNoActive")
			expect(await revokeBoost(env, actor, lyricsId, "web")).toEqual({
				ok: false,
				reason: "not_found",
			})
		})
	})

	describe("admin revoke", () => {
		it("clears an active boost with no ownership check and frees the slot", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAdminRevoke")

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
			expect(await revokeBoostByAdmin(env, lyricsId)).toEqual({ ok: true })

			const mirror = await lyricMirror(lyricsId)
			expect(mirror.committee_approved_at).toBeNull()
			expect(mirror.committee_approved_by).toBeNull()

			const revoked = await one<{ revoked_at: number | null }>(
				"SELECT revoked_at FROM boosts WHERE lyrics_id = $1 ORDER BY id DESC LIMIT 1",
				[lyricsId]
			)
			expect(revoked.revoked_at).not.toBeNull()

			expect((await createBoost(env, booster, lyricsId, "web")).ok).toBe(true)
		})

		it("not_found when there is no active boost", async () => {
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAdminNoBoost")
			expect(await revokeBoostByAdmin(env, lyricsId)).toEqual({ ok: false, reason: "not_found" })
		})
	})

	describe("council log", () => {
		const log = async () =>
			(await listCouncilEvents(env, { includeBookmarks: false, limit: 50 })).events

		it("logs a seal with its booster and source", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(await newUser(), "vidLogSeal")
			expect((await createBoost(env, booster, lyricsId, "discord")).ok).toBe(true)
			const events = await log()
			expect(events).toHaveLength(1)
			expect(events[0]).toMatchObject({ kind: "seal", source: "discord", undone: false })
			expect(events[0].actor?.userId).toBe(booster)
			expect(events[0].lyric?.id).toBe(lyricsId)
		})

		it("logs an unseal by its actor and marks the seal undone", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(await newUser(), "vidLogUnseal")
			await createBoost(env, booster, lyricsId, "web")
			await revokeBoost(env, booster, lyricsId, "web")
			const events = await log()
			expect(events.map((e) => [e.kind, e.undone])).toEqual([
				["unseal", false],
				["seal", true],
			])
			expect(events[0].actor?.userId).toBe(booster)
		})

		it("logs an admin revoke without an actor", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(await newUser(), "vidLogAdmin")
			await createBoost(env, booster, lyricsId, "web")
			await revokeBoostByAdmin(env, lyricsId)
			const [unseal] = await log()
			expect(unseal).toMatchObject({ kind: "unseal", source: "admin", actor: null })
		})

		it("logs nothing for a refused seal", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(booster, "vidLogSelf")
			expect(await createBoost(env, booster, lyricsId, "web")).toEqual({
				ok: false,
				reason: "self",
			})
			expect(await log()).toEqual([])
		})

		it("lifts an active bookmark on the sealed lyric", async () => {
			const booster = await newUser()
			const holder = await newUser()
			await addToCommittee(booster)
			await addToCommittee(holder)
			const lyricsId = await insertLyric(await newUser(), "vidLogBookmark")
			expect((await createBookmark(env, holder, "seal", lyricsId, "web")).ok).toBe(true)
			await createBoost(env, booster, lyricsId, "web")
			expect(await listActiveBookmarks(env)).toEqual([])
		})
	})

	describe("quota", () => {
		it("tracks active boosts and resets at a future epoch", async () => {
			const booster = await newUser()
			await addVeteran(booster)
			const submitter = await newUser()
			const ids = await Promise.all(
				["vidQuotaA", "vidQuotaB", "vidQuotaC"].map((v) => insertLyric(submitter, v))
			)

			const now = Math.floor(Date.now() / 1000)
			const before = await getQuota(env, booster)
			expect(before.quota).toBe(3)
			expect(before.used).toBe(0)
			expect(before.remaining).toBe(3)
			expect(before.resetsAt).toBeGreaterThan(now)

			for (const id of ids) await createBoost(env, booster, id, "web")
			const full = await getQuota(env, booster)
			expect(full.used).toBe(3)
			expect(full.remaining).toBe(0)

			await revokeBoost(env, booster, ids[0], "web")
			const freed = await getQuota(env, booster)
			expect(freed.used).toBe(2)
			expect(freed.remaining).toBe(1)
		})

		it("earns one seal per two upvoted lyrics from last month", async () => {
			const member = await newUser()
			await addVeteran(member)
			for (const [i, score] of [1, 0.5, 0.2, 1, 0, -0.3].entries()) {
				await insertOwnLyric(member, `vidEarn${i}`, {
					createdAt: lastMonth,
					effectiveScore: score,
					voteCount: 1,
				})
			}

			const quota = await getQuota(env, member)
			expect(quota.quota).toBe(8)
			expect(quota.basis).toEqual({
				active: true,
				upvotedLyrics: 4,
				bonus: 2,
				monthStart: lastMonthStart,
			})
		})

		it("drops a member with no lyrics last month to the inactive quota", async () => {
			const member = await newUser()
			await addVeteran(member)

			const quota = await getQuota(env, member)
			expect(quota.quota).toBe(3)
			expect(quota.basis).toEqual({
				active: false,
				upvotedLyrics: 0,
				bonus: 0,
				monthStart: lastMonthStart,
			})
		})

		it("counts a single unvoted lyric as active", async () => {
			const member = await newUser()
			await addVeteran(member)
			await insertOwnLyric(member, "vidActiveOnly", { createdAt: lastMonth })

			const quota = await getQuota(env, member)
			expect(quota.quota).toBe(6)
			expect(quota.basis.active).toBe(true)
			expect(quota.basis.upvotedLyrics).toBe(0)
		})

		it("gives a member who joined this month the base quota", async () => {
			const member = await newUser()
			await addToCommittee(member)

			const quota = await getQuota(env, member)
			expect(quota.quota).toBe(6)
			expect(quota.basis.active).toBe(true)
		})

		describe("edge cases", () => {
			it("ignores lyrics from this month and from two months ago", async () => {
				const member = await newUser()
				await addVeteran(member)
				await insertOwnLyric(member, "vidThisMonth", {
					createdAt: monthStart + 60,
					effectiveScore: 1,
				})
				await insertOwnLyric(member, "vidTwoMonths", {
					createdAt: lastMonthStart - 60,
					effectiveScore: 1,
				})

				const quota = await getQuota(env, member)
				expect(quota.quota).toBe(3)
				expect(quota.basis.active).toBe(false)
			})

			it("ignores deleted, auto-hidden and rejected lyrics", async () => {
				const member = await newUser()
				await addVeteran(member)
				const deleted = await insertOwnLyric(member, "vidDeleted", {
					createdAt: lastMonth,
					effectiveScore: 1,
				})
				await pool.query(
					"UPDATE lyrics SET deleted_at = $2, deleted_by_user_id = $3, deleted_by_role = 'submitter' WHERE id = $1",
					[deleted, lastMonth, member]
				)
				await insertOwnLyric(member, "vidHidden", {
					createdAt: lastMonth,
					effectiveScore: -1,
					voteCount: 2,
					downvotes: 2,
				})
				const rejected = await insertOwnLyric(member, "vidRejected", {
					createdAt: lastMonth,
					effectiveScore: 1,
				})
				const rejecter = await newUser()
				await pool.query(
					"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, $3)",
					[rejected, rejecter, lastMonth]
				)

				const quota = await getQuota(env, member)
				expect(quota.quota).toBe(3)
				expect(quota.basis.active).toBe(false)
			})

			it("counts a lyric again once its rejection is undone", async () => {
				const member = await newUser()
				await addVeteran(member)
				const lyric = await insertOwnLyric(member, "vidUnrejected", {
					createdAt: lastMonth,
					effectiveScore: 1,
				})
				const rejecter = await newUser()
				await pool.query(
					"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at, revoked_at) VALUES ($1, $2, $3, $3)",
					[lyric, rejecter, lastMonth]
				)

				expect((await getQuota(env, member)).basis.active).toBe(true)
			})

			it("caps the quota at twelve", async () => {
				const member = await newUser()
				await addVeteran(member)
				for (let i = 0; i < 20; i++) {
					await insertOwnLyric(member, `vidCap${i}`, { createdAt: lastMonth, effectiveScore: 1 })
				}

				const quota = await getQuota(env, member)
				expect(quota.quota).toBe(12)
				expect(quota.basis.bonus).toBe(6)
				expect(quota.basis.upvotedLyrics).toBe(20)
			})

			it("only counts the member's own lyrics", async () => {
				const member = await newUser()
				await addVeteran(member)
				const other = await newUser()
				await insertOwnLyric(other, "vidOther", { createdAt: lastMonth, effectiveScore: 1 })

				expect((await getQuota(env, member)).basis.active).toBe(false)
			})

			it("keeps remaining at zero when the quota falls below seals already placed", async () => {
				const member = await newUser()
				await addToCommittee(member)
				const submitter = await newUser()
				const ids = await Promise.all(
					["vidFallA", "vidFallB", "vidFallC", "vidFallD"].map((v) => insertLyric(submitter, v))
				)
				for (const id of ids) expect((await createBoost(env, member, id, "web")).ok).toBe(true)
				await pool.query("UPDATE committee_members SET added_at = $2 WHERE user_id = $1", [
					member,
					lastMonthStart - 86400,
				])

				const quota = await getQuota(env, member)
				expect(quota.quota).toBe(3)
				expect(quota.used).toBe(4)
				expect(quota.remaining).toBe(0)
				expect(await activeBoostRow(ids[0])).toMatchObject({ revoked_at: null })
			})
		})

		it("regression: concurrent boosts cannot exceed the monthly quota", async () => {
			const booster = await newUser()
			await addVeteran(booster)
			const submitter = await newUser()
			const lyricIds = await Promise.all(
				["cc1", "cc2", "cc3", "cc4", "cc5"].map((v) => insertLyric(submitter, v))
			)

			const results = await Promise.all(lyricIds.map((id) => createBoost(env, booster, id, "web")))

			expect(results.filter((r) => r.ok).length).toBe(3)
			expect(results.filter((r) => !r.ok && r.reason === "over_quota").length).toBe(2)

			const active = await one<{ n: number }>(
				"SELECT count(*)::int n FROM boosts WHERE booster_id = $1 AND revoked_at IS NULL",
				[booster]
			)
			expect(Number(active.n)).toBe(3)
		})
	})
})
