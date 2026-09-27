import { readFileSync } from "node:fs"
import { evaluateAndAward } from "@/db/badges"
import { D1Compat } from "@/infra/database"
import { userRoutes } from "@/routes/users"
import { wipeCouncilTables } from "@/test/integration-harness"
import type { Confidence, Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const nowEpoch = (): number => Math.floor(Date.now() / 1000)

function makeCache() {
	const store = new Map<string, string>()
	return {
		store,
		async get(key: string) {
			return store.get(key) ?? null
		},
		async put(key: string, value: string) {
			store.set(key, value)
		},
		async delete(key: string) {
			store.delete(key)
		},
		async keys() {
			return [...store.keys()]
		},
		async setNX(key: string, value: string) {
			if (store.has(key)) return false
			store.set(key, value)
			return true
		},
	}
}

describeIntegration("user badges and featured routes (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let cache: ReturnType<typeof makeCache>
	let env: Env
	let videoSeq = 0

	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		cache = makeCache()
		const limiter = {
			async limit() {
				return { success: true }
			},
		}
		env = {
			DB: new D1Compat(pool),
			CACHE: cache,
			RATE_LIMITER: limiter,
			READ_RATE_LIMITER: limiter,
			CACHE_TTL_SECONDS: "300",
			DUMPS_ENABLED: false,
			DUMP_PUBLIC_BASE_URL: "",
			DUMP_DATABASE_URL: null,
			B2: null,
			CDN: null,
		} as unknown as Env
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
		await wipeCouncilTables(pool)
		await pool.query("DELETE FROM users")
		await pool.query("DELETE FROM public_keys")
		cache.store.clear()
	}

	async function seedUser(keyId: string): Promise<number> {
		const row = await one<{ id: number }>("INSERT INTO users (key_id) VALUES ($1) RETURNING id", [
			keyId,
		])
		return row.id
	}

	async function insertLyric(submitterId: number, confidence: Confidence): Promise<void> {
		videoSeq++
		await pool.query(
			`INSERT INTO lyrics
				(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
				 submitter_id, confidence, effective_score, upvotes, downvotes, vote_count)
			 VALUES ($1,'Song','Artist',180,'song','artist','gz','lrc','linesync',$2,$3,0,0,0,0)`,
			[`vid${videoSeq}`, submitterId, confidence]
		)
	}

	function seedSession(token: string, keyId: string) {
		const issuedAt = nowEpoch()
		cache.store.set(
			`session:${token}`,
			JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + 600 })
		)
	}

	beforeEach(wipe)

	it("persists earned featured badges over the authed PUT and reflects them on GET", async () => {
		const keyId = "a".repeat(64)
		const userId = await seedUser(keyId)
		await insertLyric(userId, "medium")
		await evaluateAndAward(env, userId)
		seedSession("tok", keyId)

		const app = userRoutes(env)
		const putRes = await app.handle(
			new Request("http://localhost/users/me/featured-badges", {
				method: "PUT",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify({ featured: ["verified-contributor"] }),
			})
		)
		expect(putRes.status).toBe(200)
		const put = (await putRes.json()) as {
			success: boolean
			data: { featured: string[] }
		}
		expect(put.success).toBe(true)
		expect(put.data.featured).toEqual(["verified-contributor"])

		const stored = await one<{ featured_badges: string }>(
			"SELECT featured_badges FROM users WHERE id = $1",
			[userId]
		)
		expect(JSON.parse(stored.featured_badges)).toEqual(["verified-contributor"])

		const getRes = await app.handle(new Request(`http://localhost/users/${keyId}/badges`))
		expect(getRes.status).toBe(200)
		const get = (await getRes.json()) as {
			success: boolean
			data: {
				keyId: string
				featured: string[]
				badges: Array<{ key: string; earned: boolean; featured: boolean }>
				counts: { earned: number; total: number }
			}
		}
		expect(get.data.keyId).toBe(keyId)
		expect(get.data.featured).toEqual(["verified-contributor"])
		const verified = get.data.badges.find((b) => b.key === "verified-contributor")
		expect(verified?.earned).toBe(true)
		expect(verified?.featured).toBe(true)
		const firstSubmission = get.data.badges.find((b) => b.key === "first-submission")
		expect(firstSubmission?.earned).toBe(true)
		expect(get.data.counts.earned).toBeGreaterThanOrEqual(2)
	})

	it("exposes level, xp, tier and badge counts on the self gamification profile", async () => {
		const keyId = "f".repeat(64)
		const userId = await seedUser(keyId)
		await insertLyric(userId, "medium")
		await pool.query(
			"INSERT INTO contribution_events (user_id, delta, kind, ref_type, ref_id) VALUES ($1, 50, 'seed', 'test', 1)",
			[userId]
		)
		await evaluateAndAward(env, userId)

		const app = userRoutes(env)
		const res = await app.handle(new Request(`http://localhost/users/${keyId}/badges`))
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: {
				keyId: string
				level: number
				xp: number
				tier: string | null
				counts: { earned: number; total: number }
			}
		}
		expect(json.data.keyId).toBe(keyId)
		expect(json.data.xp).toBe(50)
		expect(json.data.level).toBe(2)
		expect(json.data.tier).toBe("legendary")
		expect(json.data.counts.earned).toBeGreaterThanOrEqual(1)
		expect(json.data.counts.total).toBeGreaterThan(0)
	})

	it("rejects an unearned featured key with 400", async () => {
		const keyId = "b".repeat(64)
		await seedUser(keyId)
		seedSession("tok2", keyId)

		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", {
				method: "PUT",
				headers: { authorization: "Bearer tok2", "content-type": "application/json" },
				body: JSON.stringify({ featured: ["committee"] }),
			})
		)
		expect(res.status).toBe(400)
	})

	it("returns 401 for the PUT without a session", async () => {
		const app = userRoutes(env)
		const res = await app.handle(
			new Request("http://localhost/users/me/featured-badges", { method: "PUT" })
		)
		expect(res.status).toBe(401)
	})

	describe("GET /users/:keyId/submissions filters", () => {
		const keyId = "c".repeat(64)

		interface SubmissionSeed {
			song: string
			artist: string
			syncType: "richsync" | "linesync" | "plain"
			voteCount: number
			createdAt: number
		}

		async function insertSubmission(submitterId: number, seed: SubmissionSeed): Promise<void> {
			videoSeq++
			await pool.query(
				`INSERT INTO lyrics
					(video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type,
					 submitter_id, confidence, effective_score, upvotes, downvotes, vote_count, created_at)
				 VALUES ($1,$2,$3,180,LOWER($2),LOWER($3),'gz','lrc',$4,$5,'low',0,0,0,$6,$7)`,
				[
					`vid${videoSeq}`,
					seed.song,
					seed.artist,
					seed.syncType,
					submitterId,
					seed.voteCount,
					seed.createdAt,
				]
			)
		}

		async function seedCatalogue(): Promise<void> {
			const userId = await seedUser(keyId)
			const other = await seedUser("d".repeat(64))
			await insertSubmission(userId, {
				song: "Blinding Lights",
				artist: "The Weeknd",
				syncType: "richsync",
				voteCount: 5,
				createdAt: 1700000100,
			})
			await insertSubmission(userId, {
				song: "Save Your Tears",
				artist: "The Weeknd",
				syncType: "linesync",
				voteCount: 12,
				createdAt: 1700000200,
			})
			await insertSubmission(userId, {
				song: "Levitating",
				artist: "Dua Lipa",
				syncType: "richsync",
				voteCount: 0,
				createdAt: 1700000300,
			})
			await insertSubmission(userId, {
				song: "100%_Pure",
				artist: "Nobody",
				syncType: "plain",
				voteCount: 7,
				createdAt: 1700000400,
			})
			await insertSubmission(other, {
				song: "Blinding Lights",
				artist: "The Weeknd",
				syncType: "richsync",
				voteCount: 99,
				createdAt: 1700000500,
			})
		}

		async function songs(query: string): Promise<{ songs: string[]; nextCursor?: string }> {
			const app = userRoutes(env)
			const res = await app.handle(
				new Request(`http://localhost/users/${keyId}/submissions${query}`)
			)
			expect(res.status).toBe(200)
			const json = (await res.json()) as {
				data: { submissions: Array<{ song: string }>; nextCursor?: string }
			}
			return {
				songs: json.data.submissions.map((s) => s.song),
				nextCursor: json.data.nextCursor,
			}
		}

		async function allPages(query: string): Promise<string[]> {
			const collected: string[] = []
			let cursor: string | undefined
			do {
				const sep = query.length > 0 ? "&" : "?"
				const suffix = cursor === undefined ? "" : `${sep}cursor=${cursor}`
				const page = await songs(`${query}${suffix}`)
				collected.push(...page.songs)
				cursor = page.nextCursor
			} while (cursor !== undefined)
			return collected
		}

		beforeEach(seedCatalogue)

		it("matches the search against song or artist, case-insensitively, across every row", async () => {
			expect((await songs("?q=weeknd")).songs).toEqual(["Save Your Tears", "Blinding Lights"])
			expect((await songs("?q=LEVIT")).songs).toEqual(["Levitating"])
		})

		it("treats LIKE wildcards in the search as literal characters", async () => {
			expect((await songs("?q=%25_")).songs).toEqual(["100%_Pure"])
			expect((await songs("?q=_")).songs).toEqual(["100%_Pure"])
		})

		it("filters by sync type", async () => {
			expect((await songs("?syncType=richsync")).songs).toEqual(["Levitating", "Blinding Lights"])
			expect((await songs("?syncType=plain")).songs).toEqual(["100%_Pure"])
		})

		it("combines search and sync type", async () => {
			expect((await songs("?q=weeknd&syncType=linesync")).songs).toEqual(["Save Your Tears"])
		})

		it("sorts every sort mode over the whole set, not just the first page", async () => {
			expect(await allPages("?limit=1&sort=newest")).toEqual([
				"100%_Pure",
				"Levitating",
				"Save Your Tears",
				"Blinding Lights",
			])
			expect(await allPages("?limit=1&sort=oldest")).toEqual([
				"Blinding Lights",
				"Save Your Tears",
				"Levitating",
				"100%_Pure",
			])
			expect(await allPages("?limit=1&sort=most_votes")).toEqual([
				"Save Your Tears",
				"100%_Pure",
				"Blinding Lights",
				"Levitating",
			])
			expect(await allPages("?limit=1&sort=least_votes")).toEqual([
				"Levitating",
				"Blinding Lights",
				"100%_Pure",
				"Save Your Tears",
			])
		})

		it("keeps filters applied while paging with a cursor", async () => {
			expect(await allPages("?limit=1&syncType=richsync&sort=most_votes")).toEqual([
				"Blinding Lights",
				"Levitating",
			])
		})

		it("pages through vote ties without skipping or repeating rows", async () => {
			const userId = (await one<{ id: number }>("SELECT id FROM users WHERE key_id = $1", [keyId]))
				.id
			for (const song of ["Tie A", "Tie B", "Tie C"]) {
				await insertSubmission(userId, {
					song,
					artist: "Tied",
					syncType: "plain",
					voteCount: 3,
					createdAt: 1700001000,
				})
			}
			const paged = await allPages("?limit=2&q=tied&sort=most_votes")
			expect([...paged].sort()).toEqual(["Tie A", "Tie B", "Tie C"])
			expect(new Set(paged).size).toBe(3)
		})

		it("returns nothing when the search matches no rows", async () => {
			expect(await songs("?q=zzzz")).toEqual({ songs: [], nextCursor: undefined })
		})
	})
})
