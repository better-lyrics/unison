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
import { SIGNALS_VERSION, signalLabel, ttmlSignals } from "@/utils/ttml-signals"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createBookmark } from "./council-bookmarks"
import { listCouncilQueue } from "./council-queue"

const MIRA = "a7".repeat(32)
const SUBMITTER = "b7".repeat(32)
const OTHER = "c7".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")
const TTML = readRevisionFixture("amazing-grace.ttml")

describeIntegration("council seal queue (integration)", () => {
	let db: IntegrationDb
	let mira: number
	let submitter: number
	let other: number

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
		submitter = await seedUser(db, SUBMITTER)
		other = await seedUser(db, OTHER)
		await db.pool.query("UPDATE users SET nickname = 'Sigma', reputation = 1.7 WHERE id = $1", [
			submitter,
		])
	})

	async function candidate(
		videoId: string,
		opts: { by?: number; score?: number; up?: number; down?: number; ttml?: boolean } = {}
	): Promise<number> {
		const id = await seedLyric(db, opts.by ?? submitter, {
			lyrics: opts.ttml ? TTML : LRC,
			format: opts.ttml ? "ttml" : "lrc",
			videoId,
		})
		const up = opts.up ?? 19
		const down = opts.down ?? 1
		await db.pool.query(
			"UPDATE lyrics SET effective_score = $1, upvotes = $2, downvotes = $3, vote_count = $4, score = $5, confidence = 'medium' WHERE id = $6",
			[opts.score ?? 0.9, up, down, up + down, up - down, id]
		)
		return id
	}

	describe("happy paths", () => {
		it("lists open candidates with votes, submitter and timing", async () => {
			const id = await candidate("dQw4w9WgXcQ")
			const [item] = await listCouncilQueue(db.env)
			expect(item).toMatchObject({
				id,
				videoId: "dQw4w9WgXcQ",
				song: "Amazing Grace",
				artist: "Traditional",
				format: "lrc",
				language: "en",
				confidence: "medium",
				score: 0.9,
				upvotes: 19,
				downvotes: 1,
				voteCount: 20,
				variants: 1,
				requestsFilled: 0,
				bookmark: null,
				submitter: {
					keyId: SUBMITTER,
					displayName: "Sigma",
					reputation: 1.7,
					submissions: 1,
					sealed: 0,
				},
			})
			expect(item.createdAt).toBeGreaterThan(0)
			expect(item.flags).toEqual([])
		})

		it("carries the active bookmark holder", async () => {
			const id = await candidate("dQw4w9WgXcQ")
			await createBookmark(db.env, mira, "seal", id, "web")
			const [item] = await listCouncilQueue(db.env)
			expect(item.bookmark?.holder.keyId).toBe(MIRA)
			expect(item.bookmark?.expiresAt).toBeGreaterThan(item.bookmark?.createdAt ?? 0)
		})

		it("carries the submitter's and the bookmark holder's real badges", async () => {
			const id = await candidate("dQw4w9WgXcQ")
			await db.pool.query(
				"INSERT INTO badge_awards (user_id, badge_key, tier) VALUES ($1, 'verified-contributor', 3), ($2, 'polyglot', 1)",
				[submitter, mira]
			)
			await createBookmark(db.env, mira, "seal", id, "web")
			const [item] = await listCouncilQueue(db.env)
			expect(item.submitter).toMatchObject({
				badgeCount: 1,
				topBadge: expect.objectContaining({ key: "verified-contributor", tier: 3 }),
				featured: [expect.objectContaining({ key: "verified-contributor" })],
			})
			expect(item.bookmark?.holder).toMatchObject({
				badgeCount: 1,
				topBadge: expect.objectContaining({ key: "polyglot" }),
			})
		})

		it("gives a person without badges an empty summary", async () => {
			await candidate("dQw4w9WgXcQ")
			const [item] = await listCouncilQueue(db.env)
			expect(item.submitter).toMatchObject({ badgeCount: 0, topBadge: null, featured: [] })
		})

		it("counts other variants and filled requests for the song", async () => {
			const id = await candidate("dQw4w9WgXcQ")
			await candidate("dQw4w9WgXcQ", { by: other, score: 0.2 })
			await db.pool.query(
				"INSERT INTO request_fulfillments (video_id, lyrics_id, submitter_id, demand_snapshot, request_count_snapshot) VALUES ('dQw4w9WgXcQ', $1, $2, 3.5, 4)",
				[id, submitter]
			)
			const [item] = await listCouncilQueue(db.env)
			expect(item.id).toBe(id)
			expect(item.variants).toBe(2)
			expect(item.requestsFilled).toBe(4)
		})

		it("reports automatic checks for TTML candidates", async () => {
			await candidate("dQw4w9WgXcQ", { ttml: true })
			const [item] = await listCouncilQueue(db.env)
			const expected = ttmlSignals(TTML).map((code) => ({ code, label: signalLabel(code) }))
			expect(expected.length).toBeGreaterThan(0)
			expect(item.flags).toEqual(expected)
		})
	})

	describe("edge cases", () => {
		it("excludes sealed, rejected and council-submitted lyrics", async () => {
			const sealed = await candidate("aaaaaaaaaa1")
			const rejected = await candidate("aaaaaaaaaa2")
			await candidate("aaaaaaaaaa3", { by: mira })
			const open = await candidate("aaaaaaaaaa4")
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [sealed])
			await db.pool.query(
				"INSERT INTO rejections (lyrics_id, rejected_by, rejected_at) VALUES ($1, $2, 1)",
				[rejected, mira]
			)
			expect((await listCouncilQueue(db.env)).map((i) => i.id)).toEqual([open])
		})

		it("counts prior seals on the submitter", async () => {
			await candidate("aaaaaaaaaa5")
			const past = await candidate("aaaaaaaaaa6")
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [past])
			const [item] = await listCouncilQueue(db.env)
			expect(item.submitter?.sealed).toBe(1)
			expect(item.submitter?.submissions).toBe(2)
		})

		it("returns an empty list when nothing qualifies", async () => {
			await candidate("aaaaaaaaaa7", { score: 0 })
			expect(await listCouncilQueue(db.env)).toEqual([])
		})
	})

	describe("invariants", () => {
		it("caches automatic checks per lyric revision", async () => {
			const id = await candidate("dQw4w9WgXcQ", { ttml: true })
			await listCouncilQueue(db.env)
			const keys = [...db.cache.store.keys()].filter((k) => k.startsWith("ttml-flags:"))
			expect(keys).toHaveLength(1)
			expect(keys[0]).toContain(`:${id}:`)
			expect(keys[0]).toContain(`:v${SIGNALS_VERSION}:`)
		})
	})

	describe("regressions", () => {
		it("keeps a bookmarked candidate that fell below the queue cut-off", async () => {
			const council = config.council as { queueLimit: number }
			const limit = council.queueLimit
			council.queueLimit = 1
			try {
				await candidate("aaaaaaaaaaa", { score: 0.95 })
				const held = await candidate("bbbbbbbbbbb", { score: 0.4 })
				await createBookmark(db.env, mira, "seal", held, "web")
				const items = await listCouncilQueue(db.env)
				expect(items.map((i) => i.id)).toContain(held)
				expect(items.find((i) => i.id === held)?.bookmark?.holder.keyId).toBe(MIRA)
				expect(items).toHaveLength(2)
			} finally {
				council.queueLimit = limit
			}
		})

		it("drops a bookmarked lyric once it can no longer be sealed", async () => {
			const council = config.council as { queueLimit: number }
			const limit = council.queueLimit
			council.queueLimit = 1
			try {
				await candidate("aaaaaaaaaaa", { score: 0.95 })
				const held = await candidate("bbbbbbbbbbb", { score: 0.4 })
				await createBookmark(db.env, mira, "seal", held, "web")
				await db.pool.query("UPDATE lyrics SET effective_score = 0 WHERE id = $1", [held])
				expect((await listCouncilQueue(db.env)).map((i) => i.id)).not.toContain(held)
			} finally {
				council.queueLimit = limit
			}
		})

		it("ignores automatic checks cached before the signal rules changed", async () => {
			const id = await candidate("dQw4w9WgXcQ", { ttml: true })
			const { rows } = await db.pool.query<{ current_revision_id: number | null }>(
				"SELECT current_revision_id FROM lyrics WHERE id = $1",
				[id]
			)
			const oldKey = `ttml-flags:${id}:${rows[0].current_revision_id ?? "base"}`
			await db.env.CACHE.put(oldKey, JSON.stringify(["stale-signal"]))
			const [item] = await listCouncilQueue(db.env)
			expect(item.flags.map((f) => f.code)).toEqual(ttmlSignals(TTML))
		})
	})
})
