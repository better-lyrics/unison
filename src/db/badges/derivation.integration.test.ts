import { readFileSync } from "node:fs"
import { COMMUNITY_KEY_ID } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Confidence, Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { BADGES } from "./definitions"
import { type BadgeEvaluation, DERIVATIONS } from "./derivation"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const LAUNCH_KEYS = [
	"most-loved",
	"sharp-ear",
	"verified-contributor",
	"trailblazer",
	"first-responder",
	"polyglot",
	"committee",
	"first-submission",
	"community",
]

const nowEpoch = (): number => Math.floor(Date.now() / 1000)

describeIntegration("badge derivation (integration)", () => {
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
		const schema = readFileSync(new URL("../../../schema.sql", import.meta.url), "utf-8")
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

	async function seedUser(): Promise<number> {
		userSeq++
		const keyId = userSeq.toString(16).padStart(64, "0")
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	async function insertLyric(opts: {
		submitterId: number
		confidence?: Confidence
		language?: string | null
		effectiveScore?: number
		voteCount?: number
		upvotes?: number
		downvotes?: number
		syncType?: "richsync" | "linesync" | "plain"
		diversityBonus?: 0 | 1
		reputationPenalized?: boolean
		deleted?: boolean
		deletedByRole?: "submitter" | "admin"
	}): Promise<number> {
		videoSeq++
		const deleted = opts.deleted ?? false
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, confidence, language, effective_score, upvotes, downvotes, vote_count,
				 diversity_bonus, reputation_penalized, deleted_at, deleted_by_user_id, deleted_by_role)
			 VALUES ($1,'Song','Artist',180,'song','artist','gz','lrc',$2,
				 $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			 RETURNING id`,
			[
				`vid${videoSeq}`,
				opts.syncType ?? "linesync",
				opts.submitterId,
				opts.confidence ?? "low",
				opts.language ?? null,
				opts.effectiveScore ?? 0,
				opts.upvotes ?? 0,
				opts.downvotes ?? 0,
				opts.voteCount ?? 0,
				opts.diversityBonus ?? 0,
				opts.reputationPenalized ?? false,
				deleted ? nowEpoch() : null,
				deleted ? opts.submitterId : null,
				deleted ? (opts.deletedByRole ?? "submitter") : null,
			]
		)
		return row.id
	}

	async function seedEvents(userId: number, kind: string, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await pool.query(
				"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, 1, $2, 'test', $3)",
				[userId, kind, i + 1]
			)
		}
	}

	async function seedEvent(userId: number, kind: string, refId: number): Promise<void> {
		await pool.query(
			"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, 1, $2, 'lyric', $3)",
			[userId, kind, refId]
		)
	}

	async function seedVerified(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId, confidence: i % 2 === 0 ? "medium" : "high" })
		}
	}

	async function seedLanguages(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId, confidence: "medium", language: `lang${i}` })
		}
	}

	async function insertFulfillment(userId: number, lyricsId: number, demand = 5): Promise<void> {
		videoSeq++
		await pool.query(
			`INSERT INTO request_fulfillments
				(video_id, lyrics_id, submitter_id, demand_snapshot, request_count_snapshot)
			 VALUES ($1, $2, $3, $4, 3)`,
			[`vidf${videoSeq}`, lyricsId, userId, demand]
		)
	}

	async function seedFulfillments(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			const lyricId = await insertLyric({ submitterId: userId, confidence: "high" })
			await insertFulfillment(userId, lyricId)
		}
	}

	async function seedVote(
		lyricsId: number,
		voterId: number,
		vote: number,
		createdAt: number
	): Promise<void> {
		await pool.query(
			"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at) VALUES ($1, $2, $3, 0, $4)",
			[lyricsId, voterId, vote, createdAt]
		)
	}

	async function seedProlific(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId })
		}
	}

	async function seedFirefighter(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			const lyricId = await insertLyric({ submitterId: userId, confidence: "high" })
			await insertFulfillment(userId, lyricId, 5)
		}
	}

	async function seedKaraoke(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId, confidence: "high", syncType: "richsync" })
		}
	}

	async function seedLineDancer(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId, confidence: "medium", syncType: "linesync" })
		}
	}

	async function seedRarity(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			await insertLyric({ submitterId: userId, confidence: "medium", language: `rare${i}` })
		}
	}

	async function seedTastemaker(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			const author = await seedUser()
			const lyricId = await insertLyric({
				submitterId: author,
				effectiveScore: 0.95,
				voteCount: 5,
			})
			await seedVote(lyricId, userId, 1, 1000 + i)
		}
	}

	async function seedGuardian(userId: number, count: number): Promise<void> {
		for (let i = 0; i < count; i++) {
			const author = await seedUser()
			const lyricId = await insertLyric({ submitterId: author, reputationPenalized: true })
			await pool.query(
				"INSERT INTO reports (lyrics_id, user_id, reason) VALUES ($1, $2, 'wrong_song')",
				[lyricId, userId]
			)
		}
	}

	const run = (key: string, userId: number): Promise<BadgeEvaluation> =>
		DERIVATIONS[key](env, userId)

	async function checkTiered(
		key: string,
		seed: (userId: number, n: number) => Promise<void>,
		cases: Array<{ n: number; expected: BadgeEvaluation }>
	): Promise<void> {
		for (const c of cases) {
			const userId = await seedUser()
			await seed(userId, c.n)
			expect(await run(key, userId), `${key} at ${c.n}`).toEqual(c.expected)
		}
	}

	beforeEach(wipe)

	describe("tiered badges", () => {
		it("sharp-ear walks 10/25/50 across every tier boundary", async () => {
			const seed = (u: number, n: number) => seedEvents(u, "consensus-vote", n)
			await checkTiered("sharp-ear", seed, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 10 } } },
				{ n: 10, expected: { earned: true, tier: 1, progress: { current: 10, next: 25 } } },
				{ n: 20, expected: { earned: true, tier: 1, progress: { current: 20, next: 25 } } },
				{ n: 50, expected: { earned: true, tier: 3, progress: { current: 50, next: null } } },
				{ n: 55, expected: { earned: true, tier: 3, progress: { current: 55, next: null } } },
			])
		})

		it("trailblazer walks 5/25/100 across every tier boundary", async () => {
			const seed = (u: number, n: number) => seedEvents(u, "first-for-song", n)
			await checkTiered("trailblazer", seed, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 5 } } },
				{ n: 5, expected: { earned: true, tier: 1, progress: { current: 5, next: 25 } } },
				{ n: 10, expected: { earned: true, tier: 1, progress: { current: 10, next: 25 } } },
				{ n: 100, expected: { earned: true, tier: 3, progress: { current: 100, next: null } } },
				{ n: 105, expected: { earned: true, tier: 3, progress: { current: 105, next: null } } },
			])
		})

		it("verified-contributor walks 1/3/10 across every tier boundary", async () => {
			await checkTiered("verified-contributor", seedVerified, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 1 } } },
				{ n: 1, expected: { earned: true, tier: 1, progress: { current: 1, next: 3 } } },
				{ n: 2, expected: { earned: true, tier: 1, progress: { current: 2, next: 3 } } },
				{ n: 10, expected: { earned: true, tier: 3, progress: { current: 10, next: null } } },
				{ n: 12, expected: { earned: true, tier: 3, progress: { current: 12, next: null } } },
			])
		})

		it("polyglot walks 3/5/10 across every tier boundary", async () => {
			await checkTiered("polyglot", seedLanguages, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 3 } } },
				{ n: 3, expected: { earned: true, tier: 1, progress: { current: 3, next: 5 } } },
				{ n: 4, expected: { earned: true, tier: 1, progress: { current: 4, next: 5 } } },
				{ n: 10, expected: { earned: true, tier: 3, progress: { current: 10, next: null } } },
				{ n: 12, expected: { earned: true, tier: 3, progress: { current: 12, next: null } } },
			])
		})

		// first-responder became a tiered badge counting fulfilled requests
		it("first-responder walks 1/3/5 across every tier boundary", async () => {
			await checkTiered("first-responder", seedFulfillments, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 1 } } },
				{ n: 1, expected: { earned: true, tier: 1, progress: { current: 1, next: 3 } } },
				{ n: 3, expected: { earned: true, tier: 2, progress: { current: 3, next: 5 } } },
				{ n: 5, expected: { earned: true, tier: 3, progress: { current: 5, next: null } } },
			])
		})

		it("verified-contributor counts a lyric once even with both reached events, ignoring deleted and low", async () => {
			const userId = await seedUser()
			const lyricId = await insertLyric({ submitterId: userId, confidence: "high" })
			await seedEvent(userId, "reached-medium", lyricId)
			await seedEvent(userId, "reached-high", lyricId)
			await insertLyric({ submitterId: userId, confidence: "medium", deleted: true })
			await insertLyric({ submitterId: userId, confidence: "low" })

			expect(await run("verified-contributor", userId)).toEqual({
				earned: true,
				tier: 1,
				progress: { current: 1, next: 3 },
			})
		})

		it("polyglot counts distinct languages, ignoring null-language and low-confidence rows", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "medium", language: "en" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "en" })
			await insertLyric({ submitterId: userId, confidence: "high", language: "es" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "fr" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: null })
			await insertLyric({ submitterId: userId, confidence: "low", language: "de" })

			expect(await run("polyglot", userId)).toEqual({
				earned: true,
				tier: 1,
				progress: { current: 3, next: 5 },
			})
		})
	})

	describe("single badges", () => {
		it("most-loved earns from a high-scoring, well-voted lyric only", async () => {
			const loved = await seedUser()
			await insertLyric({ submitterId: loved, effectiveScore: 0.95, voteCount: 30 })
			const earned = await run("most-loved", loved)
			expect(earned.earned).toBe(true)
			expect(earned.tier).toBeUndefined()
			expect(earned.progress).toBeUndefined()

			const shy = await seedUser()
			await insertLyric({ submitterId: shy, effectiveScore: 0.95, voteCount: 10 })
			await insertLyric({ submitterId: shy, effectiveScore: 0.5, voteCount: 30 })
			expect(await run("most-loved", shy)).toEqual({ earned: false })
		})

		it("first-submission earns from any live lyric, never a deleted-only history", async () => {
			const author = await seedUser()
			await insertLyric({ submitterId: author })
			expect((await run("first-submission", author)).earned).toBe(true)

			const none = await seedUser()
			expect((await run("first-submission", none)).earned).toBe(false)

			const onlyDeleted = await seedUser()
			await insertLyric({ submitterId: onlyDeleted, deleted: true })
			const res = await run("first-submission", onlyDeleted)
			expect(res).toEqual({ earned: false })
			expect(res.tier).toBeUndefined()
			expect(res.progress).toBeUndefined()
		})

		it("committee earns only for a listed member", async () => {
			const member = await seedUser()
			await pool.query("INSERT INTO committee_members (user_id) VALUES ($1)", [member])
			expect((await run("committee", member)).earned).toBe(true)

			const outsider = await seedUser()
			expect(await run("committee", outsider)).toEqual({ earned: false })
		})

		it("community earns only for the shared community key", async () => {
			const community = await one<{ id: number }>(
				"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
				[COMMUNITY_KEY_ID]
			)
			const earned = await run("community", community.id)
			expect(earned.earned).toBe(true)
			expect(earned.tier).toBeUndefined()
			expect(earned.progress).toBeUndefined()

			const ordinary = await seedUser()
			expect(await run("community", ordinary)).toEqual({ earned: false })
		})
	})

	describe("wave 2 tiered badges", () => {
		it("prolific walks 25/75/150 across every tier boundary", async () => {
			await checkTiered("prolific", seedProlific, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 25 } } },
				{ n: 25, expected: { earned: true, tier: 1, progress: { current: 25, next: 75 } } },
				{ n: 75, expected: { earned: true, tier: 2, progress: { current: 75, next: 150 } } },
				{ n: 150, expected: { earned: true, tier: 3, progress: { current: 150, next: null } } },
				{ n: 151, expected: { earned: true, tier: 3, progress: { current: 151, next: null } } },
			])
		})

		it("firefighter walks 3/10/25 across every tier boundary", async () => {
			await checkTiered("firefighter", seedFirefighter, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 3 } } },
				{ n: 3, expected: { earned: true, tier: 1, progress: { current: 3, next: 10 } } },
				{ n: 10, expected: { earned: true, tier: 2, progress: { current: 10, next: 25 } } },
				{ n: 25, expected: { earned: true, tier: 3, progress: { current: 25, next: null } } },
				{ n: 26, expected: { earned: true, tier: 3, progress: { current: 26, next: null } } },
			])
		})

		it("karaoke-master walks 5/15/40 across every tier boundary", async () => {
			await checkTiered("karaoke-master", seedKaraoke, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 5 } } },
				{ n: 5, expected: { earned: true, tier: 1, progress: { current: 5, next: 15 } } },
				{ n: 15, expected: { earned: true, tier: 2, progress: { current: 15, next: 40 } } },
				{ n: 40, expected: { earned: true, tier: 3, progress: { current: 40, next: null } } },
				{ n: 41, expected: { earned: true, tier: 3, progress: { current: 41, next: null } } },
			])
		})

		it("line-dancer walks 5/15/40 across every tier boundary", async () => {
			await checkTiered("line-dancer", seedLineDancer, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 5 } } },
				{ n: 5, expected: { earned: true, tier: 1, progress: { current: 5, next: 15 } } },
				{ n: 15, expected: { earned: true, tier: 2, progress: { current: 15, next: 40 } } },
				{ n: 40, expected: { earned: true, tier: 3, progress: { current: 40, next: null } } },
				{ n: 41, expected: { earned: true, tier: 3, progress: { current: 41, next: null } } },
			])
		})

		it("rarity-hunter walks 3/6/10 across every tier boundary", async () => {
			await checkTiered("rarity-hunter", seedRarity, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 3 } } },
				{ n: 3, expected: { earned: true, tier: 1, progress: { current: 3, next: 6 } } },
				{ n: 6, expected: { earned: true, tier: 2, progress: { current: 6, next: 10 } } },
				{ n: 10, expected: { earned: true, tier: 3, progress: { current: 10, next: null } } },
				{ n: 11, expected: { earned: true, tier: 3, progress: { current: 11, next: null } } },
			])
		})

		it("tastemaker walks 5/15 across every tier boundary", async () => {
			await checkTiered("tastemaker", seedTastemaker, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 5 } } },
				{ n: 5, expected: { earned: true, tier: 1, progress: { current: 5, next: 15 } } },
				{ n: 15, expected: { earned: true, tier: 2, progress: { current: 15, next: null } } },
				{ n: 16, expected: { earned: true, tier: 2, progress: { current: 16, next: null } } },
			])
		})

		it("guardian walks 3/10 across every tier boundary", async () => {
			await checkTiered("guardian", seedGuardian, [
				{ n: 0, expected: { earned: false, tier: undefined, progress: { current: 0, next: 3 } } },
				{ n: 3, expected: { earned: true, tier: 1, progress: { current: 3, next: 10 } } },
				{ n: 10, expected: { earned: true, tier: 2, progress: { current: 10, next: null } } },
				{ n: 11, expected: { earned: true, tier: 2, progress: { current: 11, next: null } } },
			])
		})
	})

	describe("wave 2 tiered badge edges", () => {
		it("karaoke-master ignores deleted, low-confidence, and non-richsync rows", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "high", syncType: "richsync" })
			await insertLyric({ submitterId: userId, confidence: "medium", syncType: "linesync" })
			await insertLyric({ submitterId: userId, confidence: "low", syncType: "richsync" })
			await insertLyric({
				submitterId: userId,
				confidence: "high",
				syncType: "richsync",
				deleted: true,
			})

			expect(await run("karaoke-master", userId)).toEqual({
				earned: false,
				tier: undefined,
				progress: { current: 1, next: 5 },
			})
		})

		it("firefighter ignores low-demand fulfillments", async () => {
			const userId = await seedUser()
			for (let i = 0; i < 3; i++) {
				const lyricId = await insertLyric({ submitterId: userId, confidence: "high" })
				await insertFulfillment(userId, lyricId, 5)
			}
			for (let i = 0; i < 2; i++) {
				const lyricId = await insertLyric({ submitterId: userId, confidence: "high" })
				await insertFulfillment(userId, lyricId, 2)
			}

			expect(await run("firefighter", userId)).toEqual({
				earned: true,
				tier: 1,
				progress: { current: 3, next: 10 },
			})
		})

		it("rarity-hunter ignores common, null, low-confidence, and duplicate languages", async () => {
			const userId = await seedUser()
			await insertLyric({ submitterId: userId, confidence: "medium", language: "en" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "ja" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: null })
			await insertLyric({ submitterId: userId, confidence: "low", language: "xyz" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "zz1" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "zz2" })
			await insertLyric({ submitterId: userId, confidence: "medium", language: "zz1" })

			expect(await run("rarity-hunter", userId)).toEqual({
				earned: false,
				tier: undefined,
				progress: { current: 2, next: 3 },
			})
		})

		it("tastemaker ignores late upvotes, downvotes, non-winners, and self-votes", async () => {
			const userId = await seedUser()
			const author = await seedUser()

			const late = await insertLyric({ submitterId: author, effectiveScore: 0.95, voteCount: 5 })
			for (let i = 0; i < 3; i++) {
				const other = await seedUser()
				await seedVote(late, other, 1, 100 + i)
			}
			await seedVote(late, userId, 1, 200)

			const down = await insertLyric({ submitterId: author, effectiveScore: 0.95, voteCount: 5 })
			await seedVote(down, userId, -1, 100)

			const nonWinner = await insertLyric({
				submitterId: author,
				effectiveScore: 0.5,
				voteCount: 5,
			})
			await seedVote(nonWinner, userId, 1, 100)

			const selfVoted = await insertLyric({
				submitterId: author,
				effectiveScore: 0.95,
				voteCount: 5,
			})
			await pool.query(
				"INSERT INTO votes (lyrics_id, user_id, vote, is_self_vote, created_at) VALUES ($1, $2, 1, 1, 60)",
				[selfVoted, userId]
			)

			expect(await run("tastemaker", userId)).toEqual({
				earned: false,
				tier: undefined,
				progress: { current: 0, next: 5 },
			})

			const early = await insertLyric({ submitterId: author, effectiveScore: 0.95, voteCount: 5 })
			await seedVote(early, userId, 1, 50)
			const res = await run("tastemaker", userId)
			expect(res.progress?.current).toBe(1)
		})

		it("guardian ignores healthy and submitter-deleted lyrics, counts admin-deleted", async () => {
			const userId = await seedUser()
			const author = await seedUser()

			const healthy = await insertLyric({ submitterId: author })
			const submitterDeleted = await insertLyric({ submitterId: author, deleted: true })
			const adminDeleted = await insertLyric({
				submitterId: author,
				deleted: true,
				deletedByRole: "admin",
			})

			for (const lyricId of [healthy, submitterDeleted, adminDeleted]) {
				await pool.query(
					"INSERT INTO reports (lyrics_id, user_id, reason) VALUES ($1, $2, 'wrong_song')",
					[lyricId, userId]
				)
			}

			expect(await run("guardian", userId)).toEqual({
				earned: false,
				tier: undefined,
				progress: { current: 1, next: 3 },
			})
		})
	})

	describe("wave 2 single badges", () => {
		it("fan-favorite earns from a large net upvote margin", async () => {
			const loved = await seedUser()
			await insertLyric({ submitterId: loved, upvotes: 55, downvotes: 5 })
			const earned = await run("fan-favorite", loved)
			expect(earned.earned).toBe(true)
			expect(earned.tier).toBeUndefined()
			expect(earned.progress).toBeUndefined()

			const shy = await seedUser()
			await insertLyric({ submitterId: shy, upvotes: 50, downvotes: 5 })
			expect(await run("fan-favorite", shy)).toEqual({ earned: false })
		})

		it("flawless earns from a downvote-free lyric with enough upvotes", async () => {
			const clean = await seedUser()
			await insertLyric({ submitterId: clean, upvotes: 5, downvotes: 0 })
			expect((await run("flawless", clean)).earned).toBe(true)

			const dinged = await seedUser()
			await insertLyric({ submitterId: dinged, upvotes: 10, downvotes: 1 })
			expect(await run("flawless", dinged)).toEqual({ earned: false })

			const quiet = await seedUser()
			await insertLyric({ submitterId: quiet, upvotes: 4, downvotes: 0 })
			expect(await run("flawless", quiet)).toEqual({ earned: false })
		})

		it("perfectionist earns from a top-scoring lyric with a diversity bonus", async () => {
			const perfect = await seedUser()
			await insertLyric({ submitterId: perfect, diversityBonus: 1, effectiveScore: 0.95 })
			expect((await run("perfectionist", perfect)).earned).toBe(true)

			const noBonus = await seedUser()
			await insertLyric({ submitterId: noBonus, diversityBonus: 0, effectiveScore: 0.99 })
			expect(await run("perfectionist", noBonus)).toEqual({ earned: false })

			const lowScore = await seedUser()
			await insertLyric({ submitterId: lowScore, diversityBonus: 1, effectiveScore: 0.8 })
			expect(await run("perfectionist", lowScore)).toEqual({ earned: false })
		})

		it("early-adopter earns only for users created before the cutoff", async () => {
			const early = await one<{ id: number }>(
				"INSERT INTO users (key_id, created_at) VALUES ($1, 1000) RETURNING id",
				["a".repeat(64)]
			)
			expect((await run("early-adopter", early.id)).earned).toBe(true)

			const late = await one<{ id: number }>(
				"INSERT INTO users (key_id, created_at) VALUES ($1, 2000000000) RETURNING id",
				["b".repeat(64)]
			)
			expect(await run("early-adopter", late.id)).toEqual({ earned: false })
		})
	})

	describe("registry integrity", () => {
		it("maps every evaluator to a defined badge", () => {
			const keys = new Set(BADGES.map((b) => b.key))
			for (const key of Object.keys(DERIVATIONS)) {
				expect(keys.has(key)).toBe(true)
			}
		})

		it("gives all nine launch keys an evaluator", () => {
			for (const key of LAUNCH_KEYS) {
				expect(typeof DERIVATIONS[key]).toBe("function")
			}
		})
	})
})
