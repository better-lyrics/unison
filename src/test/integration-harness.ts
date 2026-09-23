import { readFileSync } from "node:fs"
import { submitLyrics } from "@/db/lyrics"
import { D1Compat } from "@/infra/database"
import type { Env, LyricsFormat } from "@/types"
import { validateLyricContent } from "@/utils/validate-lyrics"
import pg from "pg"
import { describe } from "vitest"

export const describeIntegration = process.env.RUN_INTEGRATION === "1" ? describe : describe.skip

export const BOT_SECRET = "integration-bot-secret"

export function makeMemoryCache() {
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
		async keys(pattern: string) {
			const prefix = pattern.replace(/\*$/, "")
			return [...store.keys()].filter((key) => key.startsWith(prefix))
		},
		async setNX(key: string, value: string) {
			if (store.has(key)) return false
			store.set(key, value)
			return true
		},
	}
}

export type MemoryCache = ReturnType<typeof makeMemoryCache>

export interface IntegrationDb {
	pool: pg.Pool
	cache: MemoryCache
	env: Env
}

export async function openIntegrationDb(): Promise<IntegrationDb> {
	const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL
	if (!url) throw new Error("INTEGRATION_DATABASE_URL or DATABASE_URL is required")
	const pool = new pg.Pool({ connectionString: url })
	await pool.query(readFileSync(new URL("../../schema.sql", import.meta.url), "utf-8"))
	const cache = makeMemoryCache()
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const env = {
		DB: new D1Compat(pool),
		CACHE: cache,
		RATE_LIMITER: limiter,
		READ_RATE_LIMITER: limiter,
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		BUTLER_BOT_SECRET: BOT_SECRET,
	} as unknown as Env
	return { pool, cache, env }
}

export interface TransactionHooks {
	before?: () => Promise<unknown>
	after?: () => Promise<unknown>
}

// Changes state between a save's unlocked pass and its locked transaction.
export class InterleavedDb extends D1Compat {
	transactions = 0

	constructor(
		pool: pg.Pool,
		private readonly hooks: TransactionHooks
	) {
		super(pool)
	}

	override async transaction<T>(fn: (tx: D1Compat) => Promise<T>): Promise<T> {
		this.transactions++
		await this.hooks.before?.()
		try {
			return await super.transaction(fn)
		} finally {
			await this.hooks.after?.()
		}
	}
}

export async function wipeRevisionData(db: IntegrationDb): Promise<void> {
	await db.pool.query("DELETE FROM badge_awards")
	await db.pool.query("DELETE FROM rejections")
	await db.pool.query("DELETE FROM boosts")
	await db.pool.query("DELETE FROM committee_members")
	await db.pool.query("DELETE FROM contribution_events")
	await db.pool.query("DELETE FROM request_fulfillments")
	await db.pool.query("DELETE FROM votes")
	await db.pool.query("DELETE FROM reports")
	await db.pool.query("DELETE FROM lyrics")
	await db.pool.query("DELETE FROM users")
	db.cache.store.clear()
}

export async function seedUser(db: IntegrationDb, keyId: string): Promise<number> {
	const { rows } = await db.pool.query<{ id: number }>(
		"INSERT INTO users (key_id) VALUES ($1) RETURNING id",
		[keyId]
	)
	return rows[0].id
}

export async function seedCouncilMember(db: IntegrationDb, keyId: string): Promise<number> {
	const id = await seedUser(db, keyId)
	await db.pool.query("INSERT INTO committee_members (user_id, added_by) VALUES ($1, 'test')", [id])
	return id
}

export function seedSession(db: IntegrationDb, token: string, keyId: string): void {
	const issuedAt = Math.floor(Date.now() / 1000)
	db.cache.store.set(
		`session:${token}`,
		JSON.stringify({ keyId, issuedAt, expiresAt: issuedAt + 600 })
	)
}

export async function seedLyric(
	db: IntegrationDb,
	submitterId: number,
	opts: { lyrics: string; format: LyricsFormat; videoId?: string; language?: string }
): Promise<number> {
	const validated = validateLyricContent(opts.lyrics, opts.format)
	if (!validated.ok) throw new Error(`fixture failed validation: ${validated.code}`)
	const result = await submitLyrics(
		db.env,
		{
			videoId: opts.videoId ?? "HsBfV2A5dUY",
			song: "Amazing Grace",
			artist: "Traditional",
			duration: 90,
			lyrics: opts.lyrics,
			format: validated.format,
			syncType: validated.syncType,
			language: opts.language ?? "en",
		},
		submitterId
	)
	if (!result.created) throw new Error("seed lyric was not created")
	return result.id
}

let legacySeq = 0

export async function insertLegacyLyric(
	db: IntegrationDb,
	submitterId: number,
	opts: {
		lyrics: string
		format?: LyricsFormat
		syncType?: "richsync" | "linesync" | "plain"
		language?: string | null
		deleted?: boolean
	}
): Promise<number> {
	legacySeq++
	const { rows } = await db.pool.query<{ id: number }>(
		`INSERT INTO lyrics (video_id, song, artist, duration, song_norm, artist_norm, lyrics,
			format, sync_type, language, submitter_id, created_at, updated_at,
			deleted_at, deleted_by_user_id, deleted_by_role)
		 VALUES ($1, 'Amazing Grace', 'Traditional', 90, 'amazing grace', 'traditional', $2,
			$3, $4, $5, $6, 1700000000, 1700000000, $7, $8, $9)
		 RETURNING id`,
		[
			`legacy${legacySeq}`,
			opts.lyrics,
			opts.format ?? "lrc",
			opts.syncType ?? "linesync",
			opts.language === undefined ? "en" : opts.language,
			submitterId,
			opts.deleted ? 1700000100 : null,
			opts.deleted ? submitterId : null,
			opts.deleted ? "submitter" : null,
		]
	)
	return rows[0].id
}
