import {
	describeIntegration,
	type IntegrationDb,
	openIntegrationDb,
	wipeCouncilTables,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { getGlobalFeed } from "./feed"

const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)

describeIntegration("sealed feed (integration)", () => {
	let db: IntegrationDb
	let submitterId: number
	let sealerId: number
	let videoSeq = 0

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		db.cache.store.clear()
		await db.pool.query("DELETE FROM boosts")
		await db.pool.query("DELETE FROM badge_awards")
		await db.pool.query("DELETE FROM committee_members")
		await db.pool.query("DELETE FROM contribution_events")
		await db.pool.query("DELETE FROM votes")
		await db.pool.query("DELETE FROM reports")
		await db.pool.query("DELETE FROM lyrics")
		await db.pool.query("DELETE FROM discord_links")
		await wipeCouncilTables(db.pool)
		await db.pool.query("DELETE FROM users")
		await db.pool.query("DELETE FROM public_keys")
		submitterId = await insertUser("a".repeat(64))
		sealerId = await insertUser("b".repeat(64))
	})

	async function insertUser(keyId: string): Promise<number> {
		const { rows } = await db.pool.query<{ id: number }>(
			"INSERT INTO users (key_id, reputation) VALUES ($1, 1.0) RETURNING id",
			[keyId]
		)
		return rows[0].id
	}

	interface LyricFixture {
		videoId?: string
		effectiveScore?: number
		syncType?: "richsync" | "linesync" | "plain"
		sealedAt?: number
		deleted?: boolean
		voteCount?: number
		downvotes?: number
		createdAt?: number
	}

	async function insertLyric(fixture: LyricFixture = {}): Promise<number> {
		videoSeq++
		const { rows } = await db.pool.query<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				submitter_id, effective_score, upvotes, downvotes, vote_count, created_at, deleted_at,
				deleted_by_user_id, deleted_by_role,
				committee_approved_at, committee_approved_by)
			 VALUES ($1, 'Espresso', 'Sabrina Carpenter', 175, 'espresso', 'sabrina carpenter', 'gz', 'lrc', $2,
				$3, $4, 0, $5, $6, $7, $8, CASE WHEN $8::integer IS NULL THEN NULL ELSE $3::integer END,
				CASE WHEN $8::integer IS NULL THEN NULL ELSE 'submitter' END, $9::integer,
				CASE WHEN $9::integer IS NULL THEN NULL ELSE $10::integer END)
			 RETURNING id`,
			[
				fixture.videoId ?? `vidSealed${String(videoSeq).padStart(2, "0")}`,
				fixture.syncType ?? "linesync",
				submitterId,
				fixture.effectiveScore ?? 1,
				fixture.downvotes ?? 0,
				fixture.voteCount ?? 1,
				fixture.createdAt ?? now(),
				fixture.deleted ? now() : null,
				fixture.sealedAt ?? null,
				sealerId,
			]
		)
		return rows[0].id
	}

	const sealedFeed = (filters: Parameters<typeof getGlobalFeed>[4] = {}, offset = 0, limit = 12) =>
		getGlobalFeed(db.env, limit, offset, undefined, { sealed: true, ...filters })

	describe("happy path", () => {
		it("returns only sealed lyrics, most recently sealed first", async () => {
			const older = await insertLyric({ sealedAt: now() - 2 * DAY })
			const newer = await insertLyric({ sealedAt: now() - DAY })
			await insertLyric()

			const rows = await sealedFeed({ sort: "recently-sealed" })

			expect(rows.map((r) => r.id)).toEqual([newer, older])
		})

		it("filters sealed lyrics by syncType", async () => {
			const rich = await insertLyric({ sealedAt: now(), syncType: "richsync" })
			await insertLyric({ sealedAt: now(), syncType: "linesync" })

			const rows = await getGlobalFeed(db.env, 12, 0, undefined, {
				sealed: true,
				syncType: "richsync",
			})

			expect(rows.map((r) => r.id)).toEqual([rich])
		})

		it("pages through sealed lyrics with offset", async () => {
			const ids = []
			for (let i = 0; i < 3; i++) ids.push(await insertLyric({ sealedAt: now() - i * DAY }))

			const first = await sealedFeed({ sort: "recently-sealed" }, 0, 2)
			const second = await sealedFeed({ sort: "recently-sealed" }, 2, 2)

			expect(first.map((r) => r.id)).toEqual([ids[0], ids[1]])
			expect(second.map((r) => r.id)).toEqual([ids[2]])
		})
	})

	describe("edge cases", () => {
		it("returns an empty list when nothing is sealed", async () => {
			await insertLyric()
			expect(await sealedFeed()).toEqual([])
		})

		it("shows the sealed variant of a song even when an unsealed variant ranks higher", async () => {
			await insertLyric({ videoId: "HsBfV2A5dUY", effectiveScore: 5, voteCount: 40 })
			const sealed = await insertLyric({
				videoId: "HsBfV2A5dUY",
				effectiveScore: 0.4,
				sealedAt: now(),
			})

			const rows = await sealedFeed()

			expect(rows.map((r) => r.id)).toEqual([sealed])
		})

		it("returns one row per song when two variants of the same song are sealed", async () => {
			await insertLyric({ videoId: "HsBfV2A5dUY", sealedAt: now() })
			await insertLyric({ videoId: "HsBfV2A5dUY", sealedAt: now() - DAY })

			const rows = await sealedFeed()

			expect(rows).toHaveLength(1)
		})
	})

	describe("invariants", () => {
		it("never returns deleted sealed lyrics", async () => {
			await insertLyric({ sealedAt: now(), deleted: true })
			expect(await sealedFeed()).toEqual([])
		})

		it("never returns auto-hidden sealed lyrics", async () => {
			await insertLyric({
				sealedAt: now(),
				effectiveScore: 0.1,
				voteCount: 2,
				downvotes: 2,
				createdAt: now() - 10 * DAY,
			})
			expect(await sealedFeed()).toEqual([])
		})

		it("never returns sealed lyrics with effective_score <= 0", async () => {
			await insertLyric({ sealedAt: now(), effectiveScore: 0 })
			expect(await sealedFeed()).toEqual([])
		})

		it("every returned row carries its seal columns", async () => {
			await insertLyric({ sealedAt: now() })
			const [row] = await sealedFeed()
			expect(row.committee_approved_at).not.toBeNull()
			expect(row.committee_approved_by).toBe(sealerId)
		})
	})

	describe("regressions", () => {
		it("regression: the plain global feed still includes unsealed lyrics", async () => {
			const plain = await insertLyric()
			const rows = await getGlobalFeed(db.env, 12, 0)
			expect(rows.map((r) => r.id)).toContain(plain)
		})

		it("regression: page 0 is served from the cache on the next call", async () => {
			const id = await insertLyric({ sealedAt: now() })

			const first = await sealedFeed({ sort: "recently-sealed" })
			await new Promise((resolve) => setImmediate(resolve))
			await db.pool.query("DELETE FROM lyrics WHERE id = $1", [id])
			const second = await sealedFeed({ sort: "recently-sealed" })

			expect(db.cache.store.has("feed:sealed:recently-sealed:12")).toBe(true)
			expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id))
		})
	})
})
