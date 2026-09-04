import { readFileSync } from "node:fs"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createBoost, getQuota, revokeBoost, revokeBoostByAdmin } from "./boost"

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
			const result = await createBoost(env, booster, lyricsId)
			expect(result).toEqual({ ok: false, reason: "not_committee" })
		})

		it("lyric_not_found for a bogus lyrics id", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const result = await createBoost(env, booster, 999999)
			expect(result).toEqual({ ok: false, reason: "lyric_not_found" })
		})

		it("self when the booster submitted the lyric", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const lyricsId = await insertLyric(booster, "vidSelf")
			const result = await createBoost(env, booster, lyricsId)
			expect(result).toEqual({ ok: false, reason: "self" })
		})

		it("target_committee when the lyric was submitted by another council member", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const otherCommittee = await newUser()
			await addToCommittee(otherCommittee)
			const lyricsId = await insertLyric(otherCommittee, "vidTC")
			const result = await createBoost(env, booster, lyricsId)
			expect(result).toEqual({ ok: false, reason: "target_committee" })
		})

		it("already_boosted when the lyric already has an active boost", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAB")
			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
			const result = await createBoost(env, booster, lyricsId)
			expect(result).toEqual({ ok: false, reason: "already_boosted" })
		})

		it("over_quota once an untiered booster exhausts the base quota", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const l1 = await insertLyric(submitter, "vidQ1")
			const l2 = await insertLyric(submitter, "vidQ2")
			const l3 = await insertLyric(submitter, "vidQ3")
			expect((await createBoost(env, booster, l1)).ok).toBe(true)
			expect((await createBoost(env, booster, l2)).ok).toBe(true)
			const result = await createBoost(env, booster, l3)
			expect(result).toEqual({ ok: false, reason: "over_quota" })
		})
	})

	describe("happy path", () => {
		it("records the boost and mirrors approval onto the lyric", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidHappy")

			const result = await createBoost(env, booster, lyricsId)
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

			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
			expect(await revokeBoost(env, booster, lyricsId)).toEqual({ ok: true })

			const mirror = await lyricMirror(lyricsId)
			expect(mirror.committee_approved_at).toBeNull()
			expect(mirror.committee_approved_by).toBeNull()

			const revoked = await one<{ revoked_at: number | null }>(
				"SELECT revoked_at FROM boosts WHERE lyrics_id = $1 ORDER BY id DESC LIMIT 1",
				[lyricsId]
			)
			expect(revoked.revoked_at).not.toBeNull()

			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
		})

		it("forbidden when a non-booster tries to revoke", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const other = await newUser()
			await addToCommittee(other)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidForbidden")

			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
			expect(await revokeBoost(env, other, lyricsId)).toEqual({
				ok: false,
				reason: "forbidden",
			})
		})

		it("not_found when there is no active boost to revoke", async () => {
			const actor = await newUser()
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidNoActive")
			expect(await revokeBoost(env, actor, lyricsId)).toEqual({ ok: false, reason: "not_found" })
		})
	})

	describe("admin revoke", () => {
		it("clears an active boost with no ownership check and frees the slot", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAdminRevoke")

			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
			expect(await revokeBoostByAdmin(env, lyricsId)).toEqual({ ok: true })

			const mirror = await lyricMirror(lyricsId)
			expect(mirror.committee_approved_at).toBeNull()
			expect(mirror.committee_approved_by).toBeNull()

			const revoked = await one<{ revoked_at: number | null }>(
				"SELECT revoked_at FROM boosts WHERE lyrics_id = $1 ORDER BY id DESC LIMIT 1",
				[lyricsId]
			)
			expect(revoked.revoked_at).not.toBeNull()

			expect((await createBoost(env, booster, lyricsId)).ok).toBe(true)
		})

		it("not_found when there is no active boost", async () => {
			const submitter = await newUser()
			const lyricsId = await insertLyric(submitter, "vidAdminNoBoost")
			expect(await revokeBoostByAdmin(env, lyricsId)).toEqual({ ok: false, reason: "not_found" })
		})
	})

	describe("quota", () => {
		it("reports base quota, tracks active boosts, and resets at a future epoch", async () => {
			const booster = await newUser()
			await addToCommittee(booster)
			const submitter = await newUser()
			const l1 = await insertLyric(submitter, "vidQuotaA")
			const l2 = await insertLyric(submitter, "vidQuotaB")

			const now = Math.floor(Date.now() / 1000)
			const before = await getQuota(env, booster)
			expect(before.quota).toBe(2)
			expect(before.used).toBe(0)
			expect(before.remaining).toBe(2)
			expect(before.resetsAt).toBeGreaterThan(now)

			await createBoost(env, booster, l1)
			await createBoost(env, booster, l2)
			const full = await getQuota(env, booster)
			expect(full.used).toBe(2)
			expect(full.remaining).toBe(0)

			await revokeBoost(env, booster, l1)
			const freed = await getQuota(env, booster)
			expect(freed.used).toBe(1)
			expect(freed.remaining).toBe(1)
		})
	})
})
