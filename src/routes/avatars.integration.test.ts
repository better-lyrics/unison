import { config } from "@/config"
import { AVATAR_PRESETS } from "@/db/avatar-presets"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { avatarRoutes } from "./avatars"

const KEY = "a".repeat(64)
const TOKEN = "avatar-session-token"
const PRESET = AVATAR_PRESETS[0]

interface PutResult {
	status: number
	body: { success: boolean; error?: string; code?: string; data?: { avatarUrl: string | null } }
}

describeIntegration("PUT /avatars/me (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM discord_links")
		await wipeRevisionData(db)
		await seedUser(db, KEY)
		seedSession(db, TOKEN, KEY)
	})

	async function put(body: unknown, token: string | null = TOKEN): Promise<PutResult> {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (token) headers.authorization = `Bearer ${token}`
		const res = await avatarRoutes(db.env).handle(
			new Request("http://localhost/avatars/me", {
				method: "PUT",
				headers,
				body: JSON.stringify(body),
			})
		)
		return { status: res.status, body: (await res.json()) as PutResult["body"] }
	}

	async function choiceOf(keyId: string) {
		const { rows } = await db.pool.query<{
			avatar_type: string | null
			avatar_ref: string | null
			avatar_updated_at: number | null
		}>("SELECT avatar_type, avatar_ref, avatar_updated_at FROM users WHERE key_id = $1", [keyId])
		return rows[0]
	}

	async function linkDiscord(discordAvatar: string | null) {
		await db.pool.query(
			"INSERT INTO discord_links (discord_id, key_id, discord_username, discord_avatar) VALUES ($1, $2, 'alice', $3)",
			["123456789012345678", KEY, discordAvatar]
		)
	}

	it("sets a known preset and returns its CDN url", async () => {
		const { status, body } = await put({ type: "preset", ref: PRESET.id })
		expect(status).toBe(200)
		expect(body.data?.avatarUrl).toBe(config.avatar.cdnBase + PRESET.file)
		const choice = await choiceOf(KEY)
		expect(choice.avatar_type).toBe("preset")
		expect(choice.avatar_ref).toBe(PRESET.id)
		expect(choice.avatar_updated_at).toBeGreaterThan(0)
	})

	it("sets the discord photo when the linked account has a stored hash", async () => {
		await linkDiscord("abc123")
		const { status, body } = await put({ type: "discord" })
		expect(status).toBe(200)
		expect(body.data?.avatarUrl).toBe(
			"https://cdn.discordapp.com/avatars/123456789012345678/abc123.png?size=128"
		)
		expect((await choiceOf(KEY)).avatar_type).toBe("discord")
	})

	it("clears the choice back to the generated default", async () => {
		await put({ type: "preset", ref: PRESET.id })
		const { status, body } = await put({ type: "default" })
		expect(status).toBe(200)
		expect(body.data?.avatarUrl).toBeNull()
		const choice = await choiceOf(KEY)
		expect(choice.avatar_type).toBeNull()
		expect(choice.avatar_ref).toBeNull()
	})

	it("evicts the curator leaderboard cache on a change", async () => {
		db.cache.store.set("leaderboard:users", "[]")
		await put({ type: "preset", ref: PRESET.id })
		expect(db.cache.store.has("leaderboard:users")).toBe(false)
	})

	it("accepts a signed request body", async () => {
		const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])
		const publicKey = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey
		const keyId = await hashPublicKey(publicKey)
		const payload = {
			keyId,
			nonce: "avatar-signed-nonce-0001",
			timestamp: Date.now(),
			type: "preset",
			ref: PRESET.id,
		}
		const sig = await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			pair.privateKey,
			new TextEncoder().encode(canonicalJson(payload))
		)
		const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

		const { status, body } = await put({ payload, signature, publicKey }, null)

		expect(status).toBe(200)
		expect(body.data?.avatarUrl).toBe(config.avatar.cdnBase + PRESET.file)
		expect((await choiceOf(keyId)).avatar_ref).toBe(PRESET.id)
	})

	describe("error paths", () => {
		it("rejects an unsigned request without a session and leaves the choice untouched", async () => {
			await put({ type: "preset", ref: PRESET.id })
			const res = await put({ type: "default" }, null)
			expect(res.status).toBe(400)
			expect(res.body.code).toBe("INVALID_SIGNED_BODY")
			expect((await choiceOf(KEY)).avatar_ref).toBe(PRESET.id)
		})

		it("rejects an unknown session token with 401", async () => {
			const { status } = await put({ type: "default" }, "not-a-session")
			expect(status).toBe(401)
		})

		it("rejects an unknown preset with 400 and keeps the prior choice", async () => {
			await put({ type: "preset", ref: PRESET.id })
			const { status, body } = await put({ type: "preset", ref: "not-a-preset" })
			expect(status).toBe(400)
			expect(body.error).toBe("UNKNOWN_PRESET")
			expect((await choiceOf(KEY)).avatar_ref).toBe(PRESET.id)
		})

		it("rejects a preset with no ref with 400", async () => {
			const { status, body } = await put({ type: "preset" })
			expect(status).toBe(400)
			expect(body.error).toBe("UNKNOWN_PRESET")
		})

		it("rejects discord with 409 when no account is linked", async () => {
			const { status, body } = await put({ type: "discord" })
			expect(status).toBe(409)
			expect(body.error).toBe("DISCORD_AVATAR_UNAVAILABLE")
			expect((await choiceOf(KEY)).avatar_type).toBeNull()
		})

		it("rejects discord with 409 when the link has no stored hash yet", async () => {
			await linkDiscord(null)
			const { status, body } = await put({ type: "discord" })
			expect(status).toBe(409)
			expect(body.error).toBe("DISCORD_AVATAR_UNAVAILABLE")
		})

		it("rejects an unknown type with 400", async () => {
			const { status, body } = await put({ type: "upload", ref: "https://example.com/x.png" })
			expect(status).toBe(400)
			expect(body.error).toBe("INVALID_TYPE")
		})

		it("rejects a non-string ref with 400", async () => {
			const { status, body } = await put({ type: "preset", ref: 42 })
			expect(status).toBe(400)
			expect(body.error).toBe("UNKNOWN_PRESET")
		})
	})
})
