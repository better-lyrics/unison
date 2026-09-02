import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { commitLockKey, type MigrationSession } from "@/utils/migration-session"
import { migrationRoutes } from "./migrations"

interface DBCall {
	sql: string
	params: unknown[]
}

function makeMockDB(queue: unknown[] = []) {
	const calls: DBCall[] = []
	const db = {
		calls,
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						getSql: () => sql,
						getParams: () => args,
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							return (queue.shift() as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							return { results: (queue.shift() as T[]) ?? [] }
						},
						async run(): Promise<void> {
							calls.push({ sql, params: args })
						},
					}
				},
			}
		},
		async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
			return fn(db)
		},
	}
	return db
}

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map(Object.entries(seed))
	const deletes: string[] = []
	return {
		store,
		deletes,
		async get(k: string) {
			return store.get(k) ?? null
		},
		async put(k: string, v: string) {
			store.set(k, v)
		},
		async delete(k: string) {
			deletes.push(k)
			store.delete(k)
		},
		async getDel(k: string) {
			const v = store.get(k) ?? null
			store.delete(k)
			return v
		},
		async setNX() {
			return true
		},
		async keys() {
			return []
		},
	}
}

const OAUTH = {
	clientId: "c",
	clientSecret: "s",
	redirectUri: "https://unison.boidu.dev/links/discord/callback",
}

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache>,
	overrides: Partial<Env> = {}
): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		BUTLER_BOT_SECRET: "bot-secret",
		DISCORD_OAUTH: OAUTH,
		...overrides,
	} as unknown as Env
}

const BOT = { authorization: "Bearer bot-secret" }

function post(path: string, body: unknown, headers: Record<string, string> = BOT) {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	})
}

function get(path: string, headers: Record<string, string> = BOT) {
	return new Request(`http://localhost${path}`, { method: "GET", headers })
}

async function json(res: Response) {
	return (await res.json()) as { success: boolean; data?: Record<string, unknown>; code?: string }
}

function seedSession(cache: ReturnType<typeof makeMockCache>, session: MigrationSession) {
	cache.store.set(`migration:${session.sessionId}`, JSON.stringify(session))
	cache.store.set(`migration:by-discord:${session.discordId}`, session.sessionId)
}

function baseSession(overrides: Partial<MigrationSession> = {}): MigrationSession {
	return {
		sessionId: "sess-1",
		discordId: "disc-1",
		oldKey: `${"a".repeat(58)}oldkey`,
		newKey: null,
		status: "awaiting_new_key",
		oldNickname: null,
		newNickname: null,
		oldDisplayName: null,
		newDisplayName: null,
		counts: null,
		migrationId: null,
		createdAt: 100,
		...overrides,
	}
}

describe("migration bot endpoints - auth", () => {
	it("rejects all three without a valid bearer token", async () => {
		const app = migrationRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const noauth = { authorization: "Bearer wrong" }
		expect(
			(await app.handle(post("/migrations/bot/start", { discordId: "d" }, noauth))).status
		).toBe(401)
		expect((await app.handle(get("/migrations/bot/sess-1", noauth))).status).toBe(401)
		expect(
			(await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "d" }, noauth))).status
		).toBe(401)
	})
})

describe("POST /migrations/bot/start", () => {
	it("returns not_linked when the discord has no link", async () => {
		const db = makeMockDB([null]) // getByDiscordId -> none
		const app = migrationRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/migrations/bot/start", { discordId: "disc-1" }))
		expect(res.status).toBe(400)
		expect((await json(res)).code).toBe("NOT_LINKED")
	})

	it("opens a session and returns signUrl + short old key id", async () => {
		const oldKey = `${"a".repeat(58)}oldkey`
		const db = makeMockDB([{ discord_id: "disc-1", key_id: oldKey }])
		const cache = makeMockCache()
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/migrations/bot/start", { discordId: "disc-1" }))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as Record<string, unknown>
		expect(data.status).toBe("awaiting_new_key")
		expect(data.oldKeyId).toBe("oldkey")
		expect(typeof data.sessionId).toBe("string")
		expect(data.signUrl).toContain("https://unison.boidu.dev/migrate?session=")
		expect(cache.store.get("migration:by-discord:disc-1")).toBe(data.sessionId)
	})

	it("returns already_active when a session already exists", async () => {
		const oldKey = `${"a".repeat(58)}oldkey`
		const db = makeMockDB([
			{ discord_id: "disc-1", key_id: oldKey }, // first start link lookup
			{ discord_id: "disc-1", key_id: oldKey }, // second start link lookup
		])
		const cache = makeMockCache()
		const app = migrationRoutes(makeEnv(db, cache))
		await app.handle(post("/migrations/bot/start", { discordId: "disc-1" }))
		const res = await app.handle(post("/migrations/bot/start", { discordId: "disc-1" }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_ALREADY_ACTIVE")
	})
})

describe("GET /migrations/bot/:sessionId", () => {
	it("returns expired for an unknown session", async () => {
		const app = migrationRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(get("/migrations/bot/nope"))
		const data = (await json(res)).data as Record<string, unknown>
		expect(data.status).toBe("expired")
		expect(data.counts).toBeNull()
		expect(data.newKeyId).toBeNull()
		expect(data.oldNickname).toBeNull()
		expect(data.newNickname).toBeNull()
	})

	it("reports awaiting_new_key with null new key, counts, and nicknames", async () => {
		const cache = makeMockCache()
		seedSession(cache, baseSession())
		const app = migrationRoutes(makeEnv(makeMockDB(), cache))
		const data = ((await json(await app.handle(get("/migrations/bot/sess-1")))).data ??
			{}) as Record<string, unknown>
		expect(data.status).toBe("awaiting_new_key")
		expect(data.newKeyId).toBeNull()
		expect(data.counts).toBeNull()
		expect(data.oldNickname).toBeNull()
		expect(data.newNickname).toBeNull()
	})

	it("reports ready with short new key id, dry-run counts, and both nicknames", async () => {
		const cache = makeMockCache()
		seedSession(
			cache,
			baseSession({
				status: "ready",
				newKey: `${"b".repeat(58)}newkey`,
				migrationId: 7,
				oldNickname: "Caplump",
				newNickname: "tropicawhale",
				oldDisplayName: "Caplump",
				newDisplayName: "tropicawhale",
				counts: { submissions: 2, votes: 3, reports: 0, fulfillments: 1, collisions: 1 },
			})
		)
		const app = migrationRoutes(makeEnv(makeMockDB(), cache))
		const data = ((await json(await app.handle(get("/migrations/bot/sess-1")))).data ??
			{}) as Record<string, unknown>
		expect(data.status).toBe("ready")
		expect(data.newKeyId).toBe("newkey")
		expect(data.oldNickname).toBe("Caplump")
		expect(data.newNickname).toBe("tropicawhale")
		expect(data.oldDisplayName).toBe("Caplump")
		expect(data.newDisplayName).toBe("tropicawhale")
		expect(data.counts).toEqual({
			submissions: 2,
			votes: 3,
			reports: 0,
			fulfillments: 1,
			collisions: 1,
		})
	})
})

describe("POST /migrations/bot/:sessionId/commit", () => {
	const oldKey = `${"a".repeat(58)}oldkey`
	const newKey = `${"b".repeat(58)}newkey`

	function readySession(): MigrationSession {
		return baseSession({ status: "ready", newKey, migrationId: 7 })
	}

	it("returns expired for unknown session", async () => {
		const app = migrationRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(post("/migrations/bot/nope/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(410)
		expect((await json(res)).code).toBe("MIGRATION_EXPIRED")
	})

	it("returns not_ready when the session has not been proven", async () => {
		const cache = makeMockCache()
		seedSession(cache, baseSession()) // awaiting_new_key
		const app = migrationRoutes(makeEnv(makeMockDB(), cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_NOT_READY")
	})

	it("returns not_owner when the discord no longer owns the old key", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		const db = makeMockDB([{ discord_id: "disc-1", key_id: "some-other-key" }]) // re-verify lookup
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(403)
		expect((await json(res)).code).toBe("MIGRATION_NOT_OWNER")
	})

	it("returns not_owner when a different discord tries to commit", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		const app = migrationRoutes(makeEnv(makeMockDB(), cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "attacker" }))
		expect(res.status).toBe(403)
		expect((await json(res)).code).toBe("MIGRATION_NOT_OWNER")
	})

	it("returns in_progress when a commit for the session is already running", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		cache.setNX = async () => false
		const db = makeMockDB([{ discord_id: "disc-1", key_id: oldKey }]) // re-verify link
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_IN_PROGRESS")
		expect(db.calls.some((c) => c.sql.startsWith("UPDATE") || c.sql.startsWith("DELETE"))).toBe(
			false
		)
	})

	it("commits: runs the migration, marks audit, busts caches, returns moved", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		// queue: re-verify link, then runMigration's internal reads (relabel case)
		const db = makeMockDB([
			{ discord_id: "disc-1", key_id: oldKey }, // re-verify getByDiscordId
			{ id: 1 }, // runMigration old user
			null, // runMigration new user (relabel case)
			{ discord_id: "disc-1", key_id: oldKey }, // old link
			null, // new link
			[{ id: 1, key_id: oldKey }], // users snapshot
			[], // votes snapshot
			[], // reports snapshot
			[], // lyrics snapshot
			[], // fulfillments snapshot
			[{ discord_id: "disc-1", key_id: oldKey }], // discord snapshot
			[], // requests snapshot
			{ n: 0 }, // request collisions
			// in-transaction committed audit UPDATE (run, no return)
		])
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(200)
		const data = ((await json(res)).data ?? {}) as Record<string, unknown>
		expect(data.migrationId).toBe(7)
		expect(data.moved).toEqual({
			submissions: 0,
			votes: 0,
			reports: 0,
			fulfillments: 0,
			collisionsDropped: 0,
		})
		// leaderboard + submitter cache busts happened
		expect(cache.deletes).toContain("leaderboard:users")
		// audit committed + session committed
		expect(db.calls.some((c) => c.sql.includes("status = 'committed'"))).toBe(true)
		const committed = JSON.parse(cache.store.get("migration:sess-1") ?? "{}") as MigrationSession
		expect(committed.status).toBe("committed")
		// discord index cleared
		expect(cache.store.has("migration:by-discord:disc-1")).toBe(false)
	})

	it("forwards keepNickname:new so the survivor takes the new key's nickname", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		// re-verify link, then a merge-case runMigration where the new user has a nickname
		const db = makeMockDB([
			{ discord_id: "disc-1", key_id: oldKey }, // re-verify
			{ id: 1 }, // old user
			{ id: 2 }, // new user (merge case)
			{ discord_id: "disc-1", key_id: oldKey }, // old link
			null, // new link
			[
				{ id: 1, key_id: oldKey, nickname: "Caplump" },
				{ id: 2, key_id: newKey, nickname: "tropicawhale" },
			], // users snapshot
			[], // votes
			[], // reports
			[], // lyrics
			[], // fulfillments
			[{ discord_id: "disc-1", key_id: oldKey }], // discord snapshot
			[], // requests
			{ n: 0 }, // vote collisions
			{ n: 0 }, // report collisions
			{ n: 0 }, // request collisions
		])
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(
			post("/migrations/bot/sess-1/commit", { discordId: "disc-1", keepNickname: "new" })
		)
		expect(res.status).toBe(200)
		const nick = db.calls.find((c) => c.sql.includes("UPDATE users SET nickname"))
		expect(nick).toBeDefined()
		expect(nick?.params[0]).toBe("tropicawhale")
	})

	it("releases the lock and marks failed when runMigration throws", async () => {
		const cache = makeMockCache()
		seedSession(cache, readySession())
		const db = makeMockDB([
			{ discord_id: "disc-1", key_id: oldKey }, // re-verify link
		])
		db.transaction = async () => {
			throw new Error("db exploded")
		}
		const app = migrationRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(500)
		expect((await json(res)).code).toBe("MIGRATION_FAILED")
		expect(cache.deletes).toContain(commitLockKey("sess-1"))
		const stored = JSON.parse(cache.store.get("migration:sess-1") ?? "{}") as MigrationSession
		expect(stored.status).toBe("failed")
	})

	it("returns already_committed for a committed session", async () => {
		const cache = makeMockCache()
		seedSession(cache, baseSession({ status: "committed", newKey, migrationId: 7 }))
		const app = migrationRoutes(makeEnv(makeMockDB(), cache))
		const res = await app.handle(post("/migrations/bot/sess-1/commit", { discordId: "disc-1" }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_ALREADY_COMMITTED")
	})
})
