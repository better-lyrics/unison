import { config } from "@/config"
import { AVATAR_PRESETS } from "@/db/avatar-presets"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedSession,
	seedUser,
} from "@/test/integration-harness"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { authRoutes } from "./auth"

const KEY = "b".repeat(64)
const TOKEN = "auth-avatar-token"
const PRESET = AVATAR_PRESETS[0]
const PRESET_URL = config.avatar.cdnBase + PRESET.file

interface IdentityBody {
	success: boolean
	data: { keyId: string; displayName: string; avatarUrl?: string | null }
}

describeIntegration("auth identity responses carry avatarUrl (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM discord_links")
		await db.pool.query("DELETE FROM users")
		await db.pool.query("DELETE FROM public_keys")
		db.cache.store.clear()
		await seedUser(db, KEY)
		seedSession(db, TOKEN, KEY)
	})

	async function pickPreset(keyId: string) {
		await db.pool.query(
			"UPDATE users SET avatar_type = 'preset', avatar_ref = $1 WHERE key_id = $2",
			[PRESET.id, keyId]
		)
	}

	async function call(method: string, path: string, body?: unknown): Promise<IdentityBody> {
		const res = await authRoutes(db.env).handle(
			new Request(`http://localhost${path}`, {
				method,
				headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		)
		expect(res.status).toBe(200)
		return (await res.json()) as IdentityBody
	}

	describe("GET /auth/me", () => {
		it("returns null for the generated default", async () => {
			const { data } = await call("GET", "/auth/me")
			expect(data.keyId).toBe(KEY)
			expect(data.avatarUrl).toBeNull()
		})

		it("returns the chosen preset url", async () => {
			await pickPreset(KEY)
			const { data } = await call("GET", "/auth/me")
			expect(data.avatarUrl).toBe(PRESET_URL)
		})
	})

	describe("nickname responses", () => {
		it("PUT /auth/nickname includes the avatar next to the new name", async () => {
			await pickPreset(KEY)
			const { data } = await call("PUT", "/auth/nickname", { nickname: "Avatarist" })
			expect(data.displayName).toBe("Avatarist")
			expect(data.avatarUrl).toBe(PRESET_URL)
		})

		it("DELETE /auth/nickname includes the avatar", async () => {
			await pickPreset(KEY)
			const { data } = await call("DELETE", "/auth/nickname", {})
			expect(data.avatarUrl).toBe(PRESET_URL)
		})

		it("POST /auth/nickname/me includes the avatar", async () => {
			await pickPreset(KEY)
			const { data } = await call("POST", "/auth/nickname/me", {})
			expect(data.keyId).toBe(KEY)
			expect(data.avatarUrl).toBe(PRESET_URL)
		})
	})

	describe("POST /auth/session", () => {
		it("includes the avatar of the key that signed in", async () => {
			const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
				"sign",
				"verify",
			])
			const publicKey = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey
			const keyId = await hashPublicKey(publicKey)
			await seedUser(db, keyId)
			await pickPreset(keyId)
			const nonce = "session-avatar-nonce-001"
			db.cache.store.set(`challenge:${nonce}`, "1")
			const payload = { keyId, nonce, origin: "https://example.com", timestamp: Date.now() }
			const sig = await crypto.subtle.sign(
				{ name: "ECDSA", hash: "SHA-256" },
				pair.privateKey,
				new TextEncoder().encode(canonicalJson(payload))
			)
			const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

			const res = await authRoutes(db.env).handle(
				new Request("http://localhost/auth/session", {
					method: "POST",
					headers: { "content-type": "application/json", origin: "https://example.com" },
					body: JSON.stringify({ payload, signature, publicKey }),
				})
			)

			expect(res.status).toBe(200)
			const { data } = (await res.json()) as IdentityBody
			expect(data.keyId).toBe(keyId)
			expect(data.avatarUrl).toBe(PRESET_URL)
		})
	})
})
