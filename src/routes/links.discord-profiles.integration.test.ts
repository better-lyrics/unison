import { CURATOR_LEADERBOARD_CACHE_KEY } from "@/db/leaderboard"
import {
	BOT_SECRET,
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { linkRoutes } from "./links"

const ALICE = "123456789012345678"
const BOB = "876543210987654321"
const STRANGER = "111111111111111111"
const ALICE_KEY = "a".repeat(64)
const BOB_KEY = "b".repeat(64)
const OLD_HASH = "8342729096ea3675442027381ff50dfe"
const NEW_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
const ANIMATED = "a_1234567890abcdef1234567890abcdef"

interface Profile {
	discordId: string
	avatar: string | null
	username: string
}

interface LinkRow {
	discord_id: string
	key_id: string
	discord_username: string | null
	discord_avatar: string | null
	linked_at: number
}

describeIntegration("POST /links/bot/discord-profiles (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM discord_links")
		db.cache.store.clear()
		await db.pool.query(
			`INSERT INTO discord_links (discord_id, key_id, discord_username, discord_avatar, linked_at)
			 VALUES ($1, $2, 'Alice', $3, 1700000000), ($4, $5, 'Bob', NULL, 1700000001)`,
			[ALICE, ALICE_KEY, OLD_HASH, BOB, BOB_KEY]
		)
	})

	async function push(profiles: Profile[]): Promise<{ status: number; updated?: number }> {
		const res = await linkRoutes(db.env).handle(
			new Request("http://localhost/links/bot/discord-profiles", {
				method: "POST",
				headers: { authorization: `Bearer ${BOT_SECRET}`, "content-type": "application/json" },
				body: JSON.stringify({ profiles }),
			})
		)
		const json = (await res.json()) as { data?: { updated: number } }
		return { status: res.status, updated: json.data?.updated }
	}

	async function link(discordId: string): Promise<LinkRow | undefined> {
		const { rows } = await db.pool.query<LinkRow>(
			"SELECT * FROM discord_links WHERE discord_id = $1",
			[discordId]
		)
		return rows[0]
	}

	it("stores a changed avatar hash so the next read serves the new photo", async () => {
		const res = await push([{ discordId: ALICE, avatar: NEW_HASH, username: "Alice" }])
		expect(res).toEqual({ status: 200, updated: 1 })
		expect((await link(ALICE))?.discord_avatar).toBe(NEW_HASH)
	})

	it("updates the username alongside the avatar", async () => {
		await push([{ discordId: BOB, avatar: ANIMATED, username: "Robert" }])
		const row = await link(BOB)
		expect(row?.discord_username).toBe("Robert")
		expect(row?.discord_avatar).toBe(ANIMATED)
	})

	it("evicts the curator leaderboard cache when something changed", async () => {
		db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "{}")
		await push([{ discordId: ALICE, avatar: NEW_HASH, username: "Alice" }])
		expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(false)
	})

	describe("edge cases", () => {
		it("clears the hash when the user removed their Discord avatar", async () => {
			const res = await push([{ discordId: ALICE, avatar: null, username: "Alice" }])
			expect(res.updated).toBe(1)
			expect((await link(ALICE))?.discord_avatar).toBeNull()
		})

		it("counts nothing for an unchanged profile, including a null avatar staying null", async () => {
			const res = await push([
				{ discordId: ALICE, avatar: OLD_HASH, username: "Alice" },
				{ discordId: BOB, avatar: null, username: "Bob" },
			])
			expect(res).toEqual({ status: 200, updated: 0 })
		})

		it("ignores a Discord id that is not linked", async () => {
			const res = await push([{ discordId: STRANGER, avatar: NEW_HASH, username: "Eve" }])
			expect(res.updated).toBe(0)
			expect(await link(STRANGER)).toBeUndefined()
		})
	})

	describe("invariants", () => {
		it("leaves the leaderboard cache alone when nothing changed", async () => {
			db.cache.store.set(CURATOR_LEADERBOARD_CACHE_KEY, "{}")
			await push([{ discordId: ALICE, avatar: OLD_HASH, username: "Alice" }])
			expect(db.cache.store.has(CURATOR_LEADERBOARD_CACHE_KEY)).toBe(true)
		})

		it("is idempotent: a repeated push reports no further changes", async () => {
			const profiles = [{ discordId: ALICE, avatar: NEW_HASH, username: "Alicia" }]
			expect((await push(profiles)).updated).toBe(1)
			expect((await push(profiles)).updated).toBe(0)
		})

		it("never touches key_id or linked_at", async () => {
			const before = await link(ALICE)
			await push([{ discordId: ALICE, avatar: NEW_HASH, username: "Alicia" }])
			const after = await link(ALICE)
			expect(after?.key_id).toBe(before?.key_id)
			expect(after?.linked_at).toBe(before?.linked_at)
		})
	})

	describe("error paths", () => {
		it("stores null instead of an avatar that is not a Discord image hash", async () => {
			await push([{ discordId: ALICE, avatar: "../../evil?x=", username: "Alice" }])
			expect((await link(ALICE))?.discord_avatar).toBeNull()
		})
	})

	describe("cross-field interactions", () => {
		it("changes only the rows whose profile differs within one batch", async () => {
			const res = await push([
				{ discordId: ALICE, avatar: OLD_HASH, username: "Alice" },
				{ discordId: BOB, avatar: NEW_HASH, username: "Bob" },
				{ discordId: STRANGER, avatar: NEW_HASH, username: "Eve" },
			])
			expect(res.updated).toBe(1)
			expect((await link(ALICE))?.discord_avatar).toBe(OLD_HASH)
			expect((await link(BOB))?.discord_avatar).toBe(NEW_HASH)
			const { rows } = await db.pool.query("SELECT discord_id FROM discord_links")
			expect(rows).toHaveLength(2)
		})
	})
})
