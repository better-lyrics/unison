import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { adminRoutes } from "./admin"

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
						async first<T>(): Promise<T | null> {
							calls.push({ sql, params: args })
							const item = queue.shift()
							if (item instanceof Error) throw item
							return (item as T) ?? null
						},
						async all<T>(): Promise<{ results: T[] }> {
							calls.push({ sql, params: args })
							const item = queue.shift()
							if (item instanceof Error) throw item
							return { results: (item as T[]) ?? [] }
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

function makeEnv(
	db: ReturnType<typeof makeMockDB>,
	cache: ReturnType<typeof makeMockCache>,
	overrides: Partial<Env> = {}
): Env {
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		ADMIN_SECRET: "admin-secret",
		BUTLER_BOT_SECRET: "bot-secret",
		...overrides,
	} as unknown as Env
}

const ADMIN = { authorization: "Bearer admin-secret" }

function get(path: string, headers: Record<string, string> = ADMIN) {
	return new Request(`http://localhost${path}`, { method: "GET", headers })
}

function post(path: string, body: unknown, headers: Record<string, string> = ADMIN) {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	})
}

async function json(res: Response) {
	return (await res.json()) as { success: boolean; data?: unknown; code?: string }
}

describe("GET /admin/accounts/search - auth", () => {
	it("rejects a wrong bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(
			get("/admin/accounts/search?q=abc", { authorization: "Bearer wrong" })
		)
		expect(res.status).toBe(401)
	})

	it("returns 404 when ADMIN_SECRET is unset (deploy dark)", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache(), { ADMIN_SECRET: null }))
		const res = await app.handle(get("/admin/accounts/search?q=abc"))
		expect(res.status).toBe(404)
	})

	it("does not accept the butler bot secret", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(
			get("/admin/accounts/search?q=abc", { authorization: "Bearer bot-secret" })
		)
		expect(res.status).toBe(401)
	})
})

describe("GET /admin/accounts/search", () => {
	it("returns 400 for a missing or too-short query", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		expect((await app.handle(get("/admin/accounts/search"))).status).toBe(400)
		expect((await app.handle(get("/admin/accounts/search?q=a"))).status).toBe(400)
	})

	it("maps rows to account hits with holdings and a short key id", async () => {
		const key = `${"a".repeat(58)}abc123`
		const db = makeMockDB([
			[
				{
					id: 5,
					key_id: key,
					nickname: "Caplump",
					reputation: 1.5,
					discord_id: "disc-9",
					discord_username: "cap#1",
					submissions: 3,
					votes: 10,
					reports: 1,
					requests: 2,
				},
			],
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(get("/admin/accounts/search?q=capl"))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as Record<string, unknown>[]
		expect(data).toHaveLength(1)
		expect(data[0]).toMatchObject({
			userId: 5,
			keyId: key,
			keyShort: "abc123",
			nickname: "Caplump",
			discordId: "disc-9",
			discordUsername: "cap#1",
			reputation: 1.5,
			submissions: 3,
			votes: 10,
			reports: 1,
			requests: 2,
		})
	})

	it("passes a numeric user-id match parameter when the query is all digits", async () => {
		const db = makeMockDB([[]])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		await app.handle(get("/admin/accounts/search?q=42"))
		const call = db.calls.at(-1)
		expect(call?.params).toContain(42)
	})

	it("passes a null id match parameter when the query is not numeric", async () => {
		const db = makeMockDB([[]])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		await app.handle(get("/admin/accounts/search?q=capl"))
		const call = db.calls.at(-1)
		expect(call?.params).toContain(null)
	})
})

describe("POST /admin/migrations/preview", () => {
	const oldKey = `${"a".repeat(58)}oldkey`
	const newKey = `${"b".repeat(58)}newkey`

	it("rejects without a valid admin bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(
			post("/admin/migrations/preview", { oldKey, newKey }, { authorization: "Bearer wrong" })
		)
		expect(res.status).toBe(401)
	})

	it("returns SAME_KEY when both keys are identical", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(post("/admin/migrations/preview", { oldKey, newKey: oldKey }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_SAME_KEY")
	})

	it("returns BOTH_KEYS_LINKED when both keys already have a discord link", async () => {
		const db = makeMockDB([
			{ discord_id: "d1", key_id: oldKey },
			{ discord_id: "d2", key_id: newKey },
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/preview", { oldKey, newKey }))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_BOTH_KEYS_LINKED")
	})

	it("returns OLD_KEY_NO_USER when the old key has no account", async () => {
		const db = makeMockDB([
			null, // oldLink
			null, // newLink
			null, // computeMigrationPlan -> old user lookup: none
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/preview", { oldKey, newKey }))
		expect(res.status).toBe(404)
		expect((await json(res)).code).toBe("MIGRATION_OLD_KEY_NO_USER")
	})

	it("computes the dry-run plan, writes a preview audit, and returns migrationId + plan", async () => {
		const db = makeMockDB([
			null, // oldLink
			null, // newLink
			{ id: 1, nickname: "Caplump" }, // plan: old user
			null, // plan: new user (new key unseen)
			{ n: 0 }, // plan: submissions (old identity holdings)
			{ n: 0 }, // plan: votes
			{ n: 0 }, // plan: reports
			{ n: 0 }, // plan: fulfillments
			{ n: 0 }, // plan: request collisions
			{ id: "77" }, // createPreviewAudit RETURNING id (bigint -> string from pg)
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/preview", { oldKey, newKey }))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as {
			migrationId: number
			plan: Record<string, unknown>
		}
		expect(data.migrationId).toBe(77)
		expect(data.plan).toMatchObject({
			oldUserId: 1,
			newUserId: null,
			oldNickname: "Caplump",
			newNickname: null,
			survivingNickname: "Caplump",
			counts: { submissions: 0, votes: 0, reports: 0, fulfillments: 0, collisions: 0 },
		})
		const insert = db.calls.find((c) => c.sql.includes("INSERT INTO migration_requests"))
		expect(insert?.params).toContain("admin")
	})
})

describe("POST /admin/migrations/:id/commit", () => {
	const oldKey = `${"a".repeat(58)}oldkey`
	const newKey = `${"b".repeat(58)}newkey`

	it("rejects without a valid admin bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(
			post("/admin/migrations/1/commit", {}, { authorization: "Bearer wrong" })
		)
		expect(res.status).toBe(401)
	})

	it("returns NOT_FOUND when the migration id does not exist", async () => {
		const db = makeMockDB([null])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/999/commit", {}))
		expect(res.status).toBe(404)
		expect((await json(res)).code).toBe("MIGRATION_NOT_FOUND")
	})

	it("returns ALREADY_COMMITTED for an already-committed migration", async () => {
		const db = makeMockDB([{ id: 5, status: "committed", old_key: oldKey, new_key: newKey }])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/commit", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_ALREADY_COMMITTED")
	})

	it("returns IN_PROGRESS when the commit lock is already held", async () => {
		const db = makeMockDB([{ id: 5, status: "preview", old_key: oldKey, new_key: newKey }])
		const cache = makeMockCache()
		cache.setNX = async () => false
		const app = adminRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/admin/migrations/5/commit", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_IN_PROGRESS")
		expect(db.calls.some((c) => c.sql.startsWith("UPDATE") || c.sql.startsWith("DELETE"))).toBe(
			false
		)
	})

	it("commits with keys read off the audit row, busts caches, returns moved + verification", async () => {
		const db = makeMockDB([
			{ id: 77, status: "preview", old_key: oldKey, new_key: newKey }, // getAudit (pre-commit)
			{ id: 1 }, // runMigration: old user
			null, // runMigration: new user (relabel case)
			null, // old link
			null, // new link
			[{ id: 1, key_id: oldKey }], // users snapshot
			[], // votes snapshot
			[], // reports snapshot
			[], // lyrics snapshot
			[], // fulfillments snapshot
			[], // discord snapshot
			[], // requests snapshot
			{ n: 0 }, // request collisions
			[], // invalidateCacheForSubmitter: distinct video_ids
			{
				id: 77,
				status: "committed",
				moved_submissions: 0,
				moved_votes: 0,
				moved_reports: 0,
				moved_fulfillments: 0,
				collisions_dropped: 0,
			}, // getAudit (verification)
		])
		const cache = makeMockCache()
		const app = adminRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/admin/migrations/77/commit", {}))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as {
			moved: Record<string, number>
			verification: Record<string, unknown>
		}
		expect(data.moved).toEqual({
			submissions: 0,
			votes: 0,
			reports: 0,
			fulfillments: 0,
			collisionsDropped: 0,
		})
		expect(data.verification.status).toBe("committed")
		expect(db.calls.some((c) => c.sql.includes("status = 'committed'"))).toBe(true)
		expect(
			db.calls.some((c) => c.sql.startsWith("UPDATE users SET key_id") && c.params.includes(newKey))
		).toBe(true)
	})

	it("accepts a commit with no request body (body is optional)", async () => {
		const db = makeMockDB([null]) // getAudit -> not found
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const req = new Request("http://localhost/admin/migrations/1/commit", {
			method: "POST",
			headers: ADMIN,
		})
		const res = await app.handle(req)
		// Reaches the handler (404 not_found) rather than a 422 body-validation error.
		expect(res.status).toBe(404)
		expect((await json(res)).code).toBe("MIGRATION_NOT_FOUND")
	})

	it("releases the commit lock and marks the audit failed when runMigration throws", async () => {
		const db = makeMockDB([
			{ id: 77, status: "preview", old_key: oldKey, new_key: newKey }, // getAudit (pre-commit)
			new Error("db exploded mid-transaction"), // runMigration first read throws
		])
		const cache = makeMockCache()
		const app = adminRoutes(makeEnv(db, cache))
		const res = await app.handle(post("/admin/migrations/77/commit", {}))
		expect(res.status).toBe(500)
		expect(cache.deletes).toContain("admin:migration:commit:77")
		expect(db.calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(true)
	})
})

describe("POST /admin/migrations/:id/undo", () => {
	const oldKey = `${"a".repeat(58)}oldkey`
	const newKey = `${"b".repeat(58)}newkey`

	function committedAudit(snapshot: Record<string, unknown[]>) {
		return {
			id: 5,
			status: "committed",
			old_key: oldKey,
			new_key: newKey,
			snapshot,
		}
	}

	const oldSnapUser = {
		id: 1,
		key_id: oldKey,
		reputation: 1,
		vote_count: 0,
		avg_vote: 0,
		created_at: 1,
		nickname: null,
		nickname_updated_at: null,
	}

	it("rejects without a valid admin bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(
			post("/admin/migrations/5/undo", {}, { authorization: "Bearer wrong" })
		)
		expect(res.status).toBe(401)
	})

	it("returns NOT_FOUND when the migration id does not exist", async () => {
		const db = makeMockDB([null])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/999/undo", {}))
		expect(res.status).toBe(404)
		expect((await json(res)).code).toBe("MIGRATION_NOT_FOUND")
	})

	it("returns NOT_COMMITTED for a non-committed migration", async () => {
		const db = makeMockDB([
			{ id: 5, status: "preview", old_key: oldKey, new_key: newKey, snapshot: null },
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/undo", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_NOT_COMMITTED")
	})

	const fullSnap = {
		users: [oldSnapUser],
		votes: [] as { id: number }[],
		reports: [] as { id: number }[],
		lyrics: [],
		request_fulfillments: [],
		discord_links: [],
		lyrics_requests: [],
	}

	it("returns HAS_INTERIM_ACTIVITY when new votes landed since the commit", async () => {
		const snap = { ...fullSnap, votes: [{ id: 10 }] }
		const db = makeMockDB([
			committedAudit(snap), // route getAudit
			null, // getUserByKeyId(old_key): does not resolve
			committedAudit(snap), // restoreFromSnapshot getAudit
			[{ id: 11 }], // current votes: an id not present in the snapshot
			[], // current reports
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/undo", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_HAS_INTERIM_ACTIVITY")
	})

	it("restores, marks the migration reverted, and returns restored:true", async () => {
		const db = makeMockDB([
			committedAudit(fullSnap), // route getAudit
			null, // getUserByKeyId(old_key): does not resolve
			committedAudit(fullSnap), // restoreFromSnapshot getAudit
			[], // current votes
			[], // current reports
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/undo", {}))
		expect(res.status).toBe(200)
		expect((await json(res)).data).toEqual({ restored: true })
		expect(db.calls.some((c) => c.sql.includes("SET snapshot = NULL"))).toBe(true)
	})

	it("returns ALREADY_RESTORED when the old key resolves to a user again", async () => {
		const db = makeMockDB([
			committedAudit(fullSnap), // route getAudit (snapshot present)
			{ id: 1, key_id: oldKey }, // getUserByKeyId: old key already resolves
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/undo", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_ALREADY_RESTORED")
		expect(db.calls.some((c) => c.sql.startsWith("UPDATE users SET key_id"))).toBe(false)
	})

	it("returns ALREADY_RESTORED when the snapshot was already consumed", async () => {
		const db = makeMockDB([
			{ id: 5, status: "committed", old_key: oldKey, new_key: newKey, snapshot: null },
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(post("/admin/migrations/5/undo", {}))
		expect(res.status).toBe(409)
		expect((await json(res)).code).toBe("MIGRATION_ALREADY_RESTORED")
	})
})

describe("GET /admin/migrations (list)", () => {
	it("rejects without a valid admin bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(get("/admin/migrations", { authorization: "Bearer wrong" }))
		expect(res.status).toBe(401)
	})

	it("returns recent audits with numeric ids and no snapshot", async () => {
		const db = makeMockDB([
			[
				{
					id: "2",
					status: "committed",
					old_key: "aaaa",
					new_key: "bbbb",
					moved_votes: 2,
					hasSnapshot: true,
				},
				{
					id: "1",
					status: "preview",
					old_key: "aaaa",
					new_key: "bbbb",
					moved_votes: 0,
					hasSnapshot: false,
				},
			],
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(get("/admin/migrations?limit=10"))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as Record<string, unknown>[]
		expect(data).toHaveLength(2)
		expect(data[0].id).toBe(2)
		expect(data[0].status).toBe("committed")
		expect(data[0].hasSnapshot).toBe(true)
		expect("snapshot" in data[0]).toBe(false)
	})
})

describe("GET /admin/migrations/:id", () => {
	it("rejects without a valid admin bearer", async () => {
		const app = adminRoutes(makeEnv(makeMockDB(), makeMockCache()))
		const res = await app.handle(get("/admin/migrations/5", { authorization: "Bearer wrong" }))
		expect(res.status).toBe(401)
	})

	it("returns NOT_FOUND for an unknown id", async () => {
		const db = makeMockDB([null])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(get("/admin/migrations/999"))
		expect(res.status).toBe(404)
		expect((await json(res)).code).toBe("MIGRATION_NOT_FOUND")
	})

	it("returns the audit row with hasSnapshot and without the raw snapshot", async () => {
		const db = makeMockDB([
			{
				id: "5",
				status: "committed",
				old_key: "old",
				new_key: "new",
				moved_votes: 3,
				snapshot: { users: [] },
			},
		])
		const app = adminRoutes(makeEnv(db, makeMockCache()))
		const res = await app.handle(get("/admin/migrations/5"))
		expect(res.status).toBe(200)
		const data = (await json(res)).data as Record<string, unknown>
		expect(data.id).toBe(5)
		expect(data.status).toBe("committed")
		expect(data.moved_votes).toBe(3)
		expect(data.hasSnapshot).toBe(true)
		expect(data.snapshot).toBeUndefined()
	})
})
