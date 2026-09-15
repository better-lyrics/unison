import { readFileSync } from "node:fs"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { editLyrics } from "./lyrics"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

function poolThatFailsOn(realPool: pg.Pool, needle: string): pg.Pool {
	const realConnect = realPool.connect.bind(realPool)
	return new Proxy(realPool, {
		get(target, prop, receiver) {
			if (prop !== "connect") return Reflect.get(target, prop, receiver)
			// pg's own Pool.query() connects via a callback; leave that path untouched. Only the
			// promise form (D1Compat.transaction) gets a client whose writes we can fail on demand.
			return (maybeCb?: unknown) => {
				if (typeof maybeCb === "function") return realConnect(maybeCb as never)
				return realConnect().then((client) => ({
					query: (text: string, params?: unknown[]) => {
						if (text.includes(needle)) return Promise.reject(new Error("injected DB failure"))
						return params === undefined ? client.query(text) : client.query(text, params)
					},
					release: () => client.release(),
				}))
			}
		},
	})
}

const VIDEO = "dQw4w9WgXcQ"
const EXTRA = "9bZkp7q19f0"
const content = {
	lyrics: "corrected line one\ncorrected line two",
	format: "plain" as const,
	syncType: "plain" as const,
	language: "en",
}

describeIntegration("editLyrics (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let owner: number
	let other: number

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		env = {
			DB: new D1Compat(pool),
			CACHE: {
				get: async () => null,
				put: async () => {},
				delete: async () => {},
				keys: async () => [],
			},
		} as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	beforeEach(async () => {
		for (const table of [
			"lyrics_video_ids",
			"contribution_events",
			"boosts",
			"badge_awards",
			"committee_members",
			"request_fulfillments",
			"lyrics_requests",
			"requested_songs",
			"votes",
			"reports",
			"lyrics",
			"users",
			"public_keys",
		]) {
			await pool.query(`DELETE FROM ${table}`)
		}
		owner = (await pool.query("INSERT INTO users (key_id) VALUES ('owner') RETURNING id")).rows[0]
			.id
		other = (await pool.query("INSERT INTO users (key_id) VALUES ('other') RETURNING id")).rows[0]
			.id
	})

	async function seedLyric(
		opts: {
			videoId?: string
			voteCount?: number
			committeeApprovedAt?: number
			effectiveScore?: number
		} = {}
	): Promise<number> {
		const videoId = opts.videoId ?? VIDEO
		const r = await pool.query(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, vote_count, committee_approved_at, effective_score)
			 VALUES ($1,'Song','Artist',180,'song','artist','old','plain','plain',$2,$3,$4,$5) RETURNING id`,
			[
				videoId,
				owner,
				opts.voteCount ?? 0,
				opts.committeeApprovedAt ?? null,
				opts.effectiveScore ?? 0,
			]
		)
		const id = r.rows[0].id
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2)", [
			id,
			videoId,
		])
		return id
	}

	const rowById = async (id: number) =>
		(
			await pool.query(
				"SELECT deleted_at, parent_id, submitter_id, vote_count FROM lyrics WHERE id = $1",
				[id]
			)
		).rows[0]
	const countForVideo = async (videoId: string): Promise<number> =>
		(await pool.query("SELECT COUNT(*)::INTEGER AS c FROM lyrics WHERE video_id = $1", [videoId]))
			.rows[0].c
	const reputationOf = async (userId: number): Promise<number> =>
		(await pool.query("SELECT reputation FROM users WHERE id = $1", [userId])).rows[0].reputation
	const linksFor = async (id: number): Promise<string[]> =>
		(
			await pool.query(
				"SELECT video_id FROM lyrics_video_ids WHERE lyrics_id = $1 ORDER BY video_id",
				[id]
			)
		).rows.map((r) => r.video_id as string)

	it("supersedes a zero-signal parent by the same author and inherits its links", async () => {
		const parent = await seedLyric()
		await pool.query("INSERT INTO lyrics_video_ids (lyrics_id, video_id) VALUES ($1,$2)", [
			parent,
			EXTRA,
		])

		const res = await editLyrics(env, parent, owner, content)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.id).not.toBe(parent)

		expect((await rowById(parent)).deleted_at).not.toBeNull()
		const edited = await rowById(res.id)
		expect(edited.parent_id).toBe(parent)
		expect(edited.vote_count).toBe(0)
		expect(await linksFor(res.id)).toEqual([EXTRA, VIDEO].sort())
	})

	it("supersedes a voted non-approved parent and takes its place at zero votes", async () => {
		const parent = await seedLyric({ voteCount: 5 })
		const res = await editLyrics(env, parent, owner, content)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect((await rowById(parent)).deleted_at).not.toBeNull()
		const edited = await rowById(res.id)
		expect(edited.parent_id).toBe(parent)
		expect(edited.vote_count).toBe(0)
	})

	it("never supersedes a committee-approved parent; the edit competes as a separate variant", async () => {
		const parent = await seedLyric({ voteCount: 5, committeeApprovedAt: 1_700_000_000 })
		const res = await editLyrics(env, parent, owner, content)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.id).not.toBe(parent)
		expect((await rowById(parent)).deleted_at).toBeNull()
		expect((await rowById(res.id)).parent_id).toBe(parent)
	})

	it("rejects an edit from a non-owner without touching the parent or creating a variant", async () => {
		const parent = await seedLyric()
		const before = await countForVideo(VIDEO)
		const res = await editLyrics(env, parent, other, content)
		expect(res).toEqual({ ok: false, reason: "not_owner" })
		expect((await rowById(parent)).deleted_at).toBeNull()
		expect(await countForVideo(VIDEO)).toBe(before)
	})

	describe("edge cases", () => {
		it("returns not_found for a missing parent", async () => {
			const res = await editLyrics(env, 999999, owner, content)
			expect(res).toEqual({ ok: false, reason: "not_found" })
		})

		it("returns not_found for a soft-deleted parent", async () => {
			const parent = await seedLyric()
			await pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $2, deleted_by_role = 'submitter' WHERE id = $1",
				[parent, owner]
			)
			const res = await editLyrics(env, parent, owner, content)
			expect(res).toEqual({ ok: false, reason: "not_found" })
		})
	})

	describe("regressions", () => {
		it("regression: a supersede-edit at the variant cap still succeeds", async () => {
			const parent = await seedLyric()
			for (let i = 1; i < config.submission.maxVariantsPerUserPerVideo; i++) {
				await seedLyric()
			}
			const res = await editLyrics(env, parent, owner, content)
			expect(res.ok).toBe(true)
		})

		it("regression: superseding a downvoted parent by edit does not penalize the owner", async () => {
			const parent = await seedLyric({ voteCount: 3, effectiveScore: -2 })
			const before = await reputationOf(owner)
			const res = await editLyrics(env, parent, owner, content)
			expect(res.ok).toBe(true)
			expect((await rowById(parent)).deleted_at).not.toBeNull()
			expect(await reputationOf(owner)).toBe(before)
		})

		it("invariant: the edited variant carries no votes from the parent", async () => {
			const parent = await seedLyric({ voteCount: 9 })
			const res = await editLyrics(env, parent, owner, content)
			expect(res.ok).toBe(true)
			if (!res.ok) return
			expect((await rowById(res.id)).vote_count).toBe(0)
		})

		it("regression: rolls back the whole edit when a mid-sequence write fails, leaving no duplicate", async () => {
			const parent = await seedLyric()
			const before = await countForVideo(VIDEO)
			const faultyEnv: Env = { ...env, DB: new D1Compat(poolThatFailsOn(pool, "deleted_by_role")) }

			await expect(editLyrics(faultyEnv, parent, owner, content)).rejects.toThrow()

			expect((await rowById(parent)).deleted_at).toBeNull()
			expect(await countForVideo(VIDEO)).toBe(before)
		})
	})
})
