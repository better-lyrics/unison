import { readFileSync } from "node:fs"
import { COMMUNITY_KEY_ID, config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Confidence, Env } from "@/types"
import { levelForXp } from "@/utils/xp"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { evaluateAndAward, getUserBadges, setFeatured } from "./badges"
import { BADGES } from "./badges/definitions"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const nowEpoch = (): number => Math.floor(Date.now() / 1000)
const thresholds = config.gamification.xp.levelThresholds

describeIntegration("badges award and read model (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let userSeq = 0
	let videoSeq = 0

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
		await pool.query("DELETE FROM boosts")
		await pool.query("DELETE FROM badge_awards")
		await pool.query("DELETE FROM committee_members")
		await pool.query("DELETE FROM contribution_events")
		await pool.query("DELETE FROM request_fulfillments")
		await pool.query("DELETE FROM lyrics_requests")
		await pool.query("DELETE FROM requested_songs")
		await pool.query("DELETE FROM votes")
		await pool.query("DELETE FROM reports")
		await pool.query("DELETE FROM lyrics")
		await pool.query("DELETE FROM discord_links")
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
	}

	async function seedUser(keyId?: string): Promise<number> {
		userSeq++
		const key = keyId ?? userSeq.toString(16).padStart(64, "0")
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			key,
		])
		return row.id
	}

	async function insertLyric(opts: {
		submitterId: number
		confidence?: Confidence
		language?: string | null
		artist?: string
		effectiveScore?: number
		voteCount?: number
		deleted?: boolean
	}): Promise<number> {
		videoSeq++
		const deleted = opts.deleted ?? false
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, confidence, language, effective_score, upvotes, downvotes, vote_count,
				 deleted_at, deleted_by_user_id, deleted_by_role)
			 VALUES ($1,'Song',$2,180,'song','artist','gz','lrc','linesync',
				 $3,$4,$5,$6,0,0,$7,$8,$9,$10)
			 RETURNING id`,
			[
				`vid${videoSeq}`,
				opts.artist ?? "Artist",
				opts.submitterId,
				opts.confidence ?? "low",
				opts.language ?? null,
				opts.effectiveScore ?? 0,
				opts.voteCount ?? 0,
				deleted ? nowEpoch() : null,
				deleted ? opts.submitterId : null,
				deleted ? "submitter" : null,
			]
		)
		return row.id
	}

	async function seedEvents(
		userId: number,
		kind: string,
		count: number,
		delta = 1
	): Promise<void> {
		for (let i = 0; i < count; i++) {
			await pool.query(
				"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, $2, $3, 'test', $4)",
				[userId, delta, kind, i + 1]
			)
		}
	}

	const awardsFor = (userId: number): Promise<{ badge_key: string; tier: number | null }[]> =>
		pool
			.query(
				"SELECT badge_key, tier FROM badge_awards WHERE user_id = $1 ORDER BY badge_key",
				[userId]
			)
			.then((r) => r.rows)

	beforeEach(wipe)

	describe("evaluateAndAward", () => {
		it("awards a tiered badge, is idempotent, ratchets up, and never lowers a stored tier", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "medium" })

			const first = await evaluateAndAward(env, userId)
			expect(first.find((b) => b.key === "verified-contributor")).toEqual({
				key: "verified-contributor",
				tier: 1,
			})
			const rowsAfterFirst = await awardsFor(userId)
			expect(rowsAfterFirst.find((r) => r.badge_key === "verified-contributor")?.tier).toBe(1)

			expect(await evaluateAndAward(env, userId)).toEqual([])

			await insertLyric({ submitterId: userId, confidence: "high" })
			await insertLyric({ submitterId: userId, confidence: "medium" })

			const bumped = await evaluateAndAward(env, userId)
			expect(bumped).toEqual([{ key: "verified-contributor", tier: 2 }])
			expect(
				(await awardsFor(userId)).find((r) => r.badge_key === "verified-contributor")?.tier
			).toBe(2)

			await pool.query(
				"UPDATE lyrics SET deleted_at = $1, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE submitter_id = $2 AND confidence IN ('medium','high') AND id IN (SELECT id FROM lyrics WHERE submitter_id = $2 ORDER BY id LIMIT 2)",
				[nowEpoch(), userId]
			)

			expect(await evaluateAndAward(env, userId)).toEqual([])
			expect(
				(await awardsFor(userId)).find((r) => r.badge_key === "verified-contributor")?.tier
			).toBe(2)
		})

		it("awards a single (untiered) badge with a null tier", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "low" })

			const awarded = await evaluateAndAward(env, userId)
			expect(awarded.find((b) => b.key === "first-submission")).toEqual({
				key: "first-submission",
				tier: undefined,
			})
			expect(
				(await awardsFor(userId)).find((r) => r.badge_key === "first-submission")?.tier
			).toBeNull()
		})

		it("evaluates only the community badge for a blacklisted key even when other badges qualify", async () => {
			const communityId = await seedUser(COMMUNITY_KEY_ID)
			await insertLyric({ submitterId: communityId, confidence: "high" })

			const awarded = await evaluateAndAward(env, communityId)
			expect(awarded).toEqual([{ key: "community", tier: undefined }])

			const rows = await awardsFor(communityId)
			expect(rows.map((r) => r.badge_key)).toEqual(["community"])
		})
	})

	describe("getUserBadges", () => {
		it("returns a zero-state for an unknown key", async () => {
			const g = await getUserBadges(env, "does-not-exist")
			const { level, xpForNext } = levelForXp(0, thresholds)
			expect(g).toEqual({
				keyId: "does-not-exist",
				level,
				xp: 0,
				xpForNext,
				tier: null,
				tierRank: null,
				badges: [],
				featured: [],
				counts: { earned: 0, total: BADGES.length },
			})
		})

		it("returns earned and in-progress badges with counts, featured, level, and curator tier", async () => {
			const keyId = "a".repeat(64)
			const userId = await seedUser(keyId)
			await insertLyric({ submitterId: userId, confidence: "medium", language: "en" })
			await seedEvents(userId, "consensus-vote", 5, 2)
			await seedEvents(userId, "reached-medium", 1, 20)
			await seedEvents(userId, "reached-high", 1, 20)

			await evaluateAndAward(env, userId)
			await pool.query("UPDATE users SET featured_badges = $1 WHERE id = $2", [
				JSON.stringify(["verified-contributor"]),
				userId,
			])

			const g = await getUserBadges(env, keyId)

			const verified = g.badges.find((b) => b.key === "verified-contributor")
			expect(verified?.earned).toBe(true)
			expect(verified?.tier).toBe(1)
			expect(verified?.progress).toEqual({ current: 1, next: 3 })
			expect(typeof verified?.earnedAt).toBe("number")
			expect(verified?.featured).toBe(true)

			const firstSubmission = g.badges.find((b) => b.key === "first-submission")
			expect(firstSubmission?.earned).toBe(true)
			expect(firstSubmission?.featured).toBe(false)

			const sharpEar = g.badges.find((b) => b.key === "sharp-ear")
			expect(sharpEar?.earned).toBe(false)
			expect(sharpEar?.progress).toEqual({ current: 5, next: 10 })
			expect(sharpEar?.featured).toBe(false)

			expect(g.badges.map((b) => b.key)).toEqual(BADGES.map((b) => b.key))
			expect(g.counts).toEqual({ earned: 2, total: BADGES.length })
			expect(g.featured).toEqual(["verified-contributor"])

			expect(g.xp).toBe(50)
			expect(g.level).toBe(2)
			expect(g.xpForNext).toBe(150)

			expect(g.tier).toBe("legendary")
			expect(g.tierRank).toBe(1)
		})

		it("gives a pure voter xp and level but no curator tier", async () => {
			const keyId = "b".repeat(64)
			const userId = await seedUser(keyId)
			await seedEvents(userId, "consensus-vote", 25, 2)

			const g = await getUserBadges(env, keyId)

			expect(g.xp).toBe(50)
			expect(g.level).toBe(2)
			expect(g.tier).toBeNull()
			expect(g.tierRank).toBeNull()
		})

		it("presents only the community badge for a blacklisted key", async () => {
			const communityId = await seedUser(COMMUNITY_KEY_ID)
			await insertLyric({ submitterId: communityId, confidence: "high" })
			await evaluateAndAward(env, communityId)

			const g = await getUserBadges(env, COMMUNITY_KEY_ID)

			expect(g.badges.map((b) => b.key)).toEqual(["community"])
			expect(g.badges[0].earned).toBe(true)
			expect(g.tier).toBeNull()
			expect(g.tierRank).toBeNull()
			expect(g.topExpertise).toBeUndefined()
		})

		it("computes top artist and language expertise with the user's rank", async () => {
			const keyId = "c".repeat(64)
			const userId = await seedUser(keyId)
			for (let i = 0; i < 3; i++)
				await insertLyric({ submitterId: userId, confidence: "medium", artist: "Radiohead", language: "en" })
			for (let i = 0; i < 2; i++)
				await insertLyric({ submitterId: userId, confidence: "medium", artist: "Bjork", language: "is" })

			const rival = await seedUser()
			for (let i = 0; i < 5; i++)
				await insertLyric({ submitterId: rival, confidence: "medium", artist: "Radiohead", language: "en" })

			const g = await getUserBadges(env, keyId)

			expect(g.topExpertise).toEqual([
				{ scope: "artist", name: "Radiohead", rank: 2 },
				{ scope: "language", name: "en", rank: 2 },
			])
		})
	})

	describe("setFeatured", () => {
		it("rejects an unearned badge key", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "medium" })
			await evaluateAndAward(env, userId)

			expect(await setFeatured(env, userId, ["committee"])).toEqual({
				ok: false,
				reason: "unearned",
			})
		})

		it("rejects a list over the featured cap", async () => {
			const userId = await seedUser()
			const overCap = Array.from({ length: config.gamification.featured.maxSlots + 1 }, (_, i) => `k${i}`)

			expect(await setFeatured(env, userId, overCap)).toEqual({
				ok: false,
				reason: "over_cap",
			})
		})

		it("persists earned keys and echoes them back on the gamification profile", async () => {
			const keyId = "d".repeat(64)
			const userId = await seedUser(keyId)
			await insertLyric({ submitterId: userId, confidence: "medium" })
			await evaluateAndAward(env, userId)

			const keys = ["verified-contributor", "first-submission"]
			const result = await setFeatured(env, userId, keys)
			expect(result.ok).toBe(true)
			if (!result.ok) throw new Error("expected ok result")

			expect(result.gamification.featured).toEqual(keys)
			for (const key of keys) {
				expect(result.gamification.badges.find((b) => b.key === key)?.featured).toBe(true)
			}
			expect(
				result.gamification.badges.find((b) => b.key === "sharp-ear")?.featured
			).toBe(false)

			const stored = await one<{ featured_badges: string }>(
				"SELECT featured_badges FROM users WHERE id = $1",
				[userId]
			)
			expect(JSON.parse(stored.featured_badges)).toEqual(keys)
		})
	})
})
