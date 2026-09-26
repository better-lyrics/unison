import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"
import {
	getByDiscordId,
	getByKeyId,
	linkDiscord,
	listLinks,
	unlinkByKeyId,
	refreshDiscordProfile,
} from "./discordLinks"

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
							queue.shift()
						},
					}
				},
			}
		},
		async batch(stmts: Array<{ getSql(): string; getParams(): unknown[] }>): Promise<void> {
			for (const stmt of stmts) {
				calls.push({ sql: stmt.getSql(), params: stmt.getParams() })
			}
		},
	}
	return db
}

function makeEnv(db: ReturnType<typeof makeMockDB>): Env {
	return { DB: db as unknown as Env["DB"] } as unknown as Env
}

const KEY = "a".repeat(64)

describe("discordLinks", () => {
	describe("linkDiscord", () => {
		it("clears any prior link on either side, then inserts the new one", async () => {
			const db = makeMockDB([null, null])
			await linkDiscord(makeEnv(db), {
				discordId: "discord-1",
				keyId: KEY,
				discordUsername: "alice",
				discordAvatar: null,
			})

			const del = db.calls.find((c) => c.sql.includes("DELETE FROM discord_links"))
			expect(del?.sql).toContain("key_id = ? OR discord_id = ?")
			expect(del?.params).toEqual([KEY, "discord-1"])

			const insert = db.calls.find((c) => c.sql.includes("INSERT INTO discord_links"))
			expect(insert?.params).toEqual(["discord-1", KEY, "alice", null, expect.any(Number)])
		})

		it("stores a null username when none is provided", async () => {
			const db = makeMockDB([null, null])
			await linkDiscord(makeEnv(db), {
				discordId: "d2",
				keyId: KEY,
				discordUsername: null,
				discordAvatar: null,
			})
			const insert = db.calls.find((c) => c.sql.includes("INSERT INTO discord_links"))
			expect(insert?.params[2]).toBeNull()
		})

		it("regression: runs the delete and insert in one atomic batch", async () => {
			const db = makeMockDB()
			const spy = vi.spyOn(db, "batch")
			await linkDiscord(makeEnv(db), {
				discordId: "discord-1",
				keyId: KEY,
				discordUsername: "alice",
				discordAvatar: null,
			})

			expect(spy).toHaveBeenCalledOnce()
			expect(db.calls).toHaveLength(2)
			expect(db.calls[0].sql).toContain("DELETE FROM discord_links")
			expect(db.calls[1].sql).toContain("INSERT INTO discord_links")
		})

		it("regression: keeps the prior link when the insert fails mid-transaction", async () => {
			const db = makeMockDB()
			db.batch = async () => {
				throw new Error("constraint violation")
			}

			await expect(
				linkDiscord(makeEnv(db), {
					discordId: "discord-1",
					keyId: KEY,
					discordUsername: "alice",
					discordAvatar: null,
				})
			).rejects.toThrow()
			expect(db.calls).toEqual([])
		})
	})

	describe("linkDiscord avatar", () => {
		it("stores the avatar hash on insert", async () => {
			const db = makeMockDB([null, null])
			await linkDiscord(makeEnv(db), {
				discordId: "d5",
				keyId: KEY,
				discordUsername: "erin",
				discordAvatar: "hash-erin",
			})
			const insert = db.calls.find((c) => c.sql.includes("INSERT INTO discord_links"))
			expect(insert?.sql).toContain("discord_avatar")
			expect(insert?.params).toEqual(["d5", KEY, "erin", "hash-erin", expect.any(Number)])
		})
	})

	describe("refreshDiscordProfile", () => {
		const CHANGED_SQL =
			"WHERE discord_id = ? AND (discord_username IS DISTINCT FROM ? OR discord_avatar IS DISTINCT FROM ?)"

		it("rewrites the username and avatar in place for the linked discord id", async () => {
			const db = makeMockDB([{ discord_id: "d6" }])
			await refreshDiscordProfile(makeEnv(db), {
				discordId: "d6",
				discordUsername: "Alicia",
				discordAvatar: "fresh-hash",
			})
			expect(db.calls).toHaveLength(1)
			const upd = db.calls[0]
			expect(upd.sql).toContain("UPDATE discord_links SET discord_username = ?, discord_avatar = ?")
			expect(upd.sql).toContain(CHANGED_SQL)
			expect(upd.params).toEqual(["Alicia", "fresh-hash", "d6", "Alicia", "fresh-hash"])
		})

		it("reports true when a row changed", async () => {
			const db = makeMockDB([{ discord_id: "d6" }])
			const changed = await refreshDiscordProfile(makeEnv(db), {
				discordId: "d6",
				discordUsername: "Alicia",
				discordAvatar: "fresh-hash",
			})
			expect(changed).toBe(true)
		})

		it("reports false when nothing changed or the id is not linked", async () => {
			const db = makeMockDB([null])
			const changed = await refreshDiscordProfile(makeEnv(db), {
				discordId: "d6",
				discordUsername: "Alicia",
				discordAvatar: "fresh-hash",
			})
			expect(changed).toBe(false)
		})

		describe("invariants", () => {
			it("never deletes, inserts or touches linked_at or key_id", async () => {
				const db = makeMockDB([null])
				await refreshDiscordProfile(makeEnv(db), {
					discordId: "d6",
					discordUsername: "Alicia",
					discordAvatar: "h",
				})
				for (const c of db.calls) {
					expect(c.sql).not.toMatch(/DELETE|INSERT|linked_at|key_id/)
				}
			})
		})

		describe("edge cases", () => {
			it("clears the stored hash when the user removed their Discord avatar", async () => {
				const db = makeMockDB([null])
				await refreshDiscordProfile(makeEnv(db), {
					discordId: "d6",
					discordUsername: "Alicia",
					discordAvatar: null,
				})
				expect(db.calls[0].params).toEqual(["Alicia", null, "d6", "Alicia", null])
			})
		})
	})

	describe("lookups", () => {
		it("getByDiscordId returns the row when present", async () => {
			const row = { discord_id: "d1", key_id: KEY, discord_username: "alice", linked_at: 1 }
			const db = makeMockDB([row])
			expect(await getByDiscordId(makeEnv(db), "d1")).toEqual(row)
		})

		it("getByDiscordId returns null when absent", async () => {
			const db = makeMockDB([])
			expect(await getByDiscordId(makeEnv(db), "missing")).toBeNull()
		})

		it("getByKeyId returns the row when present", async () => {
			const row = { discord_id: "d1", key_id: KEY, discord_username: null, linked_at: 1 }
			const db = makeMockDB([row])
			expect(await getByKeyId(makeEnv(db), KEY)).toEqual(row)
		})
	})

	describe("unlinkByKeyId", () => {
		it("deletes the row for the key", async () => {
			const db = makeMockDB([null])
			await unlinkByKeyId(makeEnv(db), KEY)
			const del = db.calls.find((c) => c.sql.includes("DELETE FROM discord_links"))
			expect(del?.sql).toContain("WHERE key_id = ?")
			expect(del?.params).toEqual([KEY])
		})
	})

	describe("listLinks", () => {
		it("returns all discord-to-key pairs", async () => {
			const rows = [
				{ discord_id: "d1", key_id: "k1" },
				{ discord_id: "d2", key_id: "k2" },
			]
			const db = makeMockDB([rows])
			expect(await listLinks(makeEnv(db))).toEqual(rows)
		})

		it("returns an empty array when there are no links", async () => {
			const db = makeMockDB([])
			expect(await listLinks(makeEnv(db))).toEqual([])
		})
	})
})
