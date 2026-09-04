import { readFileSync } from "node:fs"
import { evaluateAndAward } from "@/db/badges"
import { D1Compat } from "@/infra/database"
import { userRoutes } from "@/routes/users"
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
})
