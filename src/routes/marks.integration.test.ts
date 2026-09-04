import { readFileSync } from "node:fs"
import { config } from "@/config"
import { D1Compat } from "@/infra/database"
import type { Env } from "@/types"
import pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildSealMarks, resolveActors } from "./marks"

const { Pool } = pg

const shouldRun = process.env.RUN_INTEGRATION === "1"
const describeIntegration = shouldRun ? describe : describe.skip

const kid = (n: number): string => n.toString(16).padStart(64, "0")

describeIntegration("seal marks (integration)", () => {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	let pool: pg.Pool
	let env: Env
	let userSeq = 0

	const store = new Map<string, string>()
	const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
		(await pool.query(sql, params)).rows[0] as T

	beforeAll(async () => {
		if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
		pool = new Pool({ connectionString: url })
		const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8")
		await pool.query(schema)
		const cache = {
			async get(key: string) {
				return store.get(key) ?? null
			},
			async put(key: string, value: string) {
				store.set(key, value)
			},
			async delete(key: string) {
				store.delete(key)
			},
		}
		env = { DB: new D1Compat(pool), CACHE: cache } as unknown as Env
	})

	afterAll(async () => {
		await pool.end()
	})

	async function wipe() {
		store.clear()
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

	async function insertUser(
		keyId: string,
		nickname: string | null,
		reputation = 1.0
	): Promise<number> {
		const row = await one<{ id: number }>(
			"INSERT INTO users (key_id, nickname, reputation) VALUES ($1, $2, $3) RETURNING id",
			[keyId, nickname, reputation]
		)
		return row.id
	}

	function newUser(nickname: string | null): Promise<number> {
		userSeq++
		return insertUser(kid(userSeq), nickname)
	}

	async function insertLyric(
		submitterId: number,
		videoId: string,
		effectiveScore: number
	): Promise<number> {
		const row = await one<{ id: number }>(
			`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics, format, sync_type, submitter_id, effective_score, upvotes, downvotes, vote_count)
			 VALUES ($1, 'Song', 'Artist', 180, 'song', 'artist', 'gz', 'lrc', 'linesync', $2, $3, 0, 0, 0) RETURNING id`,
			[videoId, submitterId, effectiveScore]
		)
		return row.id
	}

	async function approve(lyricsId: number, boosterId: number, at: number): Promise<void> {
		await pool.query(
			"UPDATE lyrics SET committee_approved_at = $1, committee_approved_by = $2 WHERE id = $3",
			[at, boosterId, lyricsId]
		)
	}

	beforeEach(wipe)

	it("builds a single seal mark for an approved lyric and none for an unapproved one", async () => {
		const boosterKeyId = kid(1000)
		const booster = await insertUser(boosterKeyId, "Council Cat")
		await insertLyric(booster, "vidBooster", 1000)

		const submitter = await newUser(null)
		const approvedId = await insertLyric(submitter, "vidApproved", 1)
		const unapprovedId = await insertLyric(submitter, "vidPlain", 1)
		await approve(approvedId, booster, 1700000000)

		const marks = await buildSealMarks(env, [
			{ id: approvedId, committee_approved_at: 1700000000, committee_approved_by: booster },
			{ id: unapprovedId, committee_approved_at: null, committee_approved_by: null },
		])

		const seal = marks.get(approvedId)
		expect(seal).toHaveLength(1)
		expect(seal?.[0]).toMatchObject({
			type: "seal",
			label: config.gamification.seal.label,
			icon: "/badges/committee/image.svg",
			at: 1700000000,
		})
		expect(seal?.[0].by).toEqual({
			keyId: boosterKeyId,
			displayName: "Council Cat",
			tier: "legendary",
		})
		expect(marks.has(unapprovedId)).toBe(false)
	})

	it("resolves the booster display name from a pet name when there is no nickname", async () => {
		const boosterKeyId = kid(2000)
		const booster = await insertUser(boosterKeyId, null)
		await insertLyric(booster, "vidBooster2", 1000)

		const submitter = await newUser(null)
		const approvedId = await insertLyric(submitter, "vidApproved2", 1)
		await approve(approvedId, booster, 1699999999)

		const actors = await resolveActors(env, [booster])
		expect(actors.get(booster)?.keyId).toBe(boosterKeyId)
		expect(actors.get(booster)?.displayName).not.toBe("")
		expect(actors.get(booster)?.tier).toBe("legendary")
	})

	it("batches over many approved rows sharing one booster (no N+1)", async () => {
		const boosterKeyId = kid(3000)
		const booster = await insertUser(boosterKeyId, "Council Cat")
		await insertLyric(booster, "vidBooster3", 1000)

		const submitter = await newUser(null)
		const rows: { id: number; committee_approved_at: number; committee_approved_by: number }[] = []
		for (let i = 0; i < 5; i++) {
			const id = await insertLyric(submitter, `vidBatch${i}`, 1)
			await approve(id, booster, 1700000000 + i)
			rows.push({ id, committee_approved_at: 1700000000 + i, committee_approved_by: booster })
		}

		const marks = await buildSealMarks(env, rows)
		expect(marks.size).toBe(5)
		for (const r of rows) {
			const seal = marks.get(r.id)
			expect(seal).toHaveLength(1)
			expect(seal?.[0].at).toBe(r.committee_approved_at)
			expect(seal?.[0].by).toEqual({
				keyId: boosterKeyId,
				displayName: "Council Cat",
				tier: "legendary",
			})
		}
	})
})

describe("buildSealMarks fast path (no approvals)", () => {
	it("issues zero DB queries when no row is fully approved", async () => {
		let queries = 0
		const db = {
			prepare() {
				return {
					bind() {
						return this
					},
					async all() {
						queries++
						return { results: [] }
					},
					async first() {
						queries++
						return null
					},
					async run() {
						queries++
					},
				}
			},
		}
		const env = {
			DB: db,
			CACHE: {
				async get() {
					return null
				},
				async put() {},
				async delete() {},
			},
		} as unknown as Env

		const result = await buildSealMarks(env, [
			{ id: 1, committee_approved_at: null, committee_approved_by: null },
			{ id: 2, committee_approved_at: 1700000000, committee_approved_by: null },
			{ id: 3, committee_approved_at: null, committee_approved_by: 9 },
		])

		expect(result.size).toBe(0)
		expect(queries).toBe(0)
	})
})
