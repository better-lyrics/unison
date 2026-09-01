import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import {
	clearDiscordIndex,
	createSession,
	getActiveSessionForDiscord,
	getSession,
	type MigrationSession,
	saveSession,
} from "./migration-session"

function makeMockCache(seed: Record<string, string> = {}) {
	const store = new Map(Object.entries(seed))
	return {
		store,
		async get(k: string) {
			return store.get(k) ?? null
		},
		async put(k: string, v: string) {
			store.set(k, v)
		},
		async delete(k: string) {
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

function makeEnv(cache: ReturnType<typeof makeMockCache>): Env {
	return { CACHE: cache as unknown as Env["CACHE"] } as unknown as Env
}

describe("migration-session", () => {
	it("creates a session, stores it, and round-trips by id", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)

		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })

		expect(session.sessionId).toBeTruthy()
		expect(session.status).toBe("awaiting_new_key")
		expect(session.oldKey).toBe("oldkey")
		expect(session.newKey).toBeNull()
		expect(session.counts).toBeNull()
		expect(session.oldNickname).toBeNull()
		expect(session.newNickname).toBeNull()

		const fetched = await getSession(env, session.sessionId)
		expect(fetched).toEqual(session)
	})

	it("indexes the session by discord id for active-session lookup", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)

		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })
		const active = await getActiveSessionForDiscord(env, "disc-1")

		expect(active?.sessionId).toBe(session.sessionId)
	})

	it("returns null active session when the discord has none", async () => {
		const env = makeEnv(makeMockCache())
		expect(await getActiveSessionForDiscord(env, "nobody")).toBeNull()
	})

	it("does not treat committed sessions as active", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })

		const committed: MigrationSession = { ...session, status: "committed" }
		await saveSession(env, committed)

		expect(await getActiveSessionForDiscord(env, "disc-1")).toBeNull()
	})

	it("does not treat failed sessions as active", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })

		await saveSession(env, { ...session, status: "failed", failureReason: "same_key" })

		expect(await getActiveSessionForDiscord(env, "disc-1")).toBeNull()
	})

	it("returns null active session when the index dangles past the session", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })

		await cache.delete(`migration:${session.sessionId}`)

		expect(await getActiveSessionForDiscord(env, "disc-1")).toBeNull()
	})

	it("clears the discord index", async () => {
		const cache = makeMockCache()
		const env = makeEnv(cache)
		const session = await createSession(env, { discordId: "disc-1", oldKey: "oldkey" })

		await clearDiscordIndex(env, "disc-1")

		expect(await getActiveSessionForDiscord(env, "disc-1")).toBeNull()
		expect(await getSession(env, session.sessionId)).not.toBeNull()
	})

	it("returns null for a missing session id", async () => {
		const env = makeEnv(makeMockCache())
		expect(await getSession(env, "nope")).toBeNull()
	})

	it("tolerates a corrupt session payload", async () => {
		const cache = makeMockCache({ "migration:bad": "{not json" })
		const env = makeEnv(cache)
		expect(await getSession(env, "bad")).toBeNull()
	})
})
