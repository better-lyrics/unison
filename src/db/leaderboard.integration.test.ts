import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID, config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import { levelForXp } from "@/utils/xp"
import { getXpForUsers } from "./contribution-events"
import { getCuratorLeaderboard, getCuratorRank } from "./leaderboard"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const TOTAL = 61
const SCAN = config.requests.leaderboard.rankScanLimit
const thresholds = config.gamification.xp.levelThresholds

describeIntegration("curator leaderboard (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env

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
		await pool.query("DELETE FROM migration_requests")
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

	async function insertLyric(
		submitterId: number,
		videoId: string,
		effectiveScore: number,
		upvotes: number
	): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, effective_score, upvotes, downvotes, vote_count)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3, $4, 0, $4) RETURNING id`,
			[videoId, submitterId, effectiveScore, upvotes]
		)
		return row.id
	}

	async function seedCurator(
		i: number,
		effectiveScore: number
	): Promise<{ id: number; keyId: string }> {
		const keyId = i.toString(16).padStart(64, "0")
		const user = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		await insertLyric(user.id, `vid${i}`, effectiveScore, 5)
		return { id: user.id, keyId }
	}

	async function seedXp(userId: number, delta: number, refId: number): Promise<void> {
		await pool.query(
			"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, $2, 'seed', 'test', $3)",
			[userId, delta, refId]
		)
	}

	async function seedPopulation(): Promise<{ id: number; keyId: string }[]> {
		const curators: { id: number; keyId: string }[] = []
		for (let rank = 1; rank <= TOTAL; rank++) {
			curators.push(await seedCurator(rank, (TOTAL - rank + 1) * 100))
		}

		await seedXp(curators[0].id, 4500, 1)
		await seedXp(curators[3].id, 150, 1)
		await seedXp(curators[3].id, 50, 2)
		await seedXp(curators[4].id, 50, 1)

		const community = await one<{ id: number }>(
			"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
			[COMMUNITY_KEY_ID]
		)
		await insertLyric(community.id, "vidCommunity", 1_000_000, 999)

		return curators
	}

	beforeEach(wipe)

	it("attaches tier, level, xp and xpForNext to every curator row", async () => {
		const curators = await seedPopulation()
		const rows = await getCuratorLeaderboard(env, SCAN)

		// The community account is shown (by its huge score) but sits outside the ranks.
		expect(rows).toHaveLength(TOTAL + 1)
		const real = rows.filter((r) => !r.community)
		expect(real).toHaveLength(TOTAL)
		expect(real[0].keyId).toBe(curators[0].keyId)

		expect(real[0].tier).toBe("legendary")
		expect(real[1].tier).toBe("grandmaster")
		expect(real[2].tier).toBe("master")
		expect(real[3].tier).toBe("elite")
		expect(real[4].tier).toBe("lyricist")
		expect(real[TOTAL - 1].tier).toBeNull()

		expect(real[0].xp).toBe(4500)
		expect({ level: real[0].level, xpForNext: real[0].xpForNext }).toEqual(
			levelForXp(4500, thresholds)
		)
		expect({ level: real[0].level, xpForNext: real[0].xpForNext }).toEqual({
			level: 9,
			xpForNext: null,
		})

		expect(real[1].xp).toBe(0)
		expect({ level: real[1].level, xpForNext: real[1].xpForNext }).toEqual({
			level: 1,
			xpForNext: 50,
		})

		expect(real[3].xp).toBe(200)
		expect({ level: real[3].level, xpForNext: real[3].xpForNext }).toEqual(
			levelForXp(200, thresholds)
		)
		expect({ level: real[3].level, xpForNext: real[3].xpForNext }).toEqual({
			level: 3,
			xpForNext: 350,
		})

		expect(real[4].xp).toBe(50)
		expect({ level: real[4].level, xpForNext: real[4].xpForNext }).toEqual({
			level: 2,
			xpForNext: 150,
		})
	})

	it("shows the community account by score but untiered, so real curators own the ranks", async () => {
		const curators = await seedPopulation()
		const rows = await getCuratorLeaderboard(env, SCAN)

		const community = rows.find((r) => r.keyId === COMMUNITY_KEY_ID)
		expect(community).toBeDefined()
		expect(community?.community).toBe(true)
		expect(community?.rank).toBe(0)
		expect(community?.tier).toBeNull()

		const real = rows.filter((r) => !r.community)
		expect(real[0].keyId).toBe(curators[0].keyId)
		expect(real[0].rank).toBe(1)
		expect(real[0].tier).toBe("legendary")
		expect(real.map((r) => r.rank)).toEqual(real.map((_, i) => i + 1))

		const rank = await getCuratorRank(env, curators[0].keyId)
		expect(rank?.rank).toBe(1)
		expect(rank?.tier).toBe("legendary")
		expect(rank?.xp).toBe(4500)
		expect(rank?.level).toBe(9)

		const communityRank = await getCuratorRank(env, COMMUNITY_KEY_ID)
		expect(communityRank?.community).toBe(true)
		expect(communityRank?.rank).toBe(0)
		expect(communityRank?.tier).toBeNull()
	})

	describe("invariants", () => {
		it("keeps every pre-existing field and adds exactly the gamification ones", async () => {
			const curators = await seedPopulation()
			const rows = await getCuratorLeaderboard(env, SCAN)

			expect(Object.keys(rows[0]).sort()).toEqual(
				[
					"keyId",
					"reputation",
					"score",
					"submissionCount",
					"totalUpvotes",
					"fulfilledCount",
					"fulfilledDemand",
					"rank",
					"community",
					"nickname",
					"discordLinked",
					"tier",
					"level",
					"xp",
					"xpForNext",
					"badgeCount",
					"topBadge",
				].sort()
			)

			const top = rows.filter((r) => !r.community)[0]
			expect(top.keyId).toBe(curators[0].keyId)
			expect(top.reputation).toBe(1)
			expect(top.score).toBe(TOTAL * 100)
			expect(top.submissionCount).toBe(1)
			expect(top.totalUpvotes).toBe(5)
			expect(top.fulfilledCount).toBe(0)
			expect(top.fulfilledDemand).toBe(0)
			expect(top.rank).toBe(1)
			expect(top.nickname).toBeNull()
			expect(top.discordLinked).toBe(false)
			expect(top.badgeCount).toBe(0)
			expect(top.topBadge).toBeNull()
		})

		it("attaches a curator's badge count and top badge to the row and rank", async () => {
			const curators = await seedPopulation()
			await pool.query(
				"INSERT INTO badge_awards (user_id, badge_key, tier) VALUES ($1, 'verified-contributor', 3), ($1, 'community', NULL)",
				[curators[0].id]
			)

			const rows = await getCuratorLeaderboard(env, SCAN)
			const top = rows.filter((r) => !r.community)[0]
			expect(top.keyId).toBe(curators[0].keyId)
			expect(top.badgeCount).toBe(2)
			expect(top.topBadge).toEqual({
				key: "verified-contributor",
				name: "Verified Contributor",
				tier: 3,
			})

			const rank = await getCuratorRank(env, curators[0].keyId)
			expect(rank?.badgeCount).toBe(2)
			expect(rank?.topBadge).toEqual({
				key: "verified-contributor",
				name: "Verified Contributor",
				tier: 3,
			})
		})
	})

	describe("regressions", () => {
		it("regression: tier bands use the full filtered population, not the truncated page", async () => {
			await seedPopulation()
			const full = await getCuratorLeaderboard(env, SCAN)
			const page = await getCuratorLeaderboard(env, 5)

			expect(page).toHaveLength(5)
			expect(page.map((r) => r.tier)).toEqual(full.slice(0, 5).map((r) => r.tier))
			// A page-tail curator keeps its full-population band, not one recomputed over 5 rows.
			expect(page[4].tier).toBe(full[4].tier)
		})
	})

	describe("getXpForUsers", () => {
		it("returns a map of summed deltas keyed by user id", async () => {
			const curators = await seedPopulation()
			const map = await getXpForUsers(env, [curators[0].id, curators[3].id, curators[1].id])

			expect(map.get(curators[0].id)).toBe(4500)
			expect(map.get(curators[3].id)).toBe(200)
			expect(map.has(curators[1].id)).toBe(false)
		})

		it("returns an empty map for empty input without a query", async () => {
			expect(await getXpForUsers(env, [])).toEqual(new Map())
		})
	})
})
