import { config } from "@/config"
import { AVATAR_PRESETS, insertPreset, setCatalogue } from "@/db/avatar-presets"
import { resolveAvatarUrl } from "@/db/users"
import {
	BOT_SECRET,
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import type { Env } from "@/types"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import sharp from "sharp"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { avatarRoutes } from "./avatars"

const KEY = "a".repeat(64)
const TOKEN = "avatar-session-token"
const PRESET = AVATAR_PRESETS[0]
const SONG = "dQw4w9WgXcQ"
const STORED_ART = "https://yt3.googleusercontent.com/abc=w544-h544-l90-rj"
const SIZED_ART = `https://yt3.googleusercontent.com/abc=w${config.avatar.artworkSize}-h${config.avatar.artworkSize}-l90-rj`
const LRC = readRevisionFixture("amazing-grace.lrc")

interface PutResult {
	status: number
	body: { success: boolean; error?: string; code?: string; data?: { avatarUrl: string | null } }
}

describeIntegration("PUT /avatars/me (integration)", () => {
	let db: IntegrationDb
	let userId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM discord_links")
		await db.pool.query("DELETE FROM song_artwork")
		await wipeRevisionData(db)
		userId = await seedUser(db, KEY)
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

	it("regression: a discord pick does not follow the key to a different Discord account", async () => {
		await linkDiscord("abc123")
		await put({ type: "discord" })
		expect((await choiceOf(KEY)).avatar_ref).toBe("123456789012345678")

		await db.pool.query("DELETE FROM discord_links WHERE key_id = $1", [KEY])
		await db.pool.query(
			"INSERT INTO discord_links (discord_id, key_id, discord_username, discord_avatar) VALUES ('222222222222222222', $1, 'bob', 'bobhash')",
			[KEY]
		)

		expect(await resolveAvatarUrl(db.env, KEY)).toBeNull()
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

	async function submitSong(submitterId: number, videoId = SONG): Promise<number> {
		return seedLyric(db, submitterId, { lyrics: LRC, format: "lrc", videoId })
	}

	async function storeArt(videoId = SONG, url: string | null = STORED_ART) {
		await db.pool.query(
			"INSERT INTO song_artwork (video_id, artwork_url, checked_at) VALUES ($1, $2, $3)",
			[videoId, url, Math.floor(Date.now() / 1000)]
		)
	}

	describe("song cover", () => {
		it("sets a submitted song and returns its cover at the avatar size", async () => {
			await submitSong(userId)
			await storeArt()
			const { status, body } = await put({ type: "song", ref: SONG })
			expect(status).toBe(200)
			expect(body.data?.avatarUrl).toBe(SIZED_ART)
			const choice = await choiceOf(KEY)
			expect(choice.avatar_type).toBe("song")
			expect(choice.avatar_ref).toBe(SONG)
		})

		it("evicts the curator leaderboard cache on a song pick", async () => {
			await submitSong(userId)
			await storeArt()
			db.cache.store.set("leaderboard:users", "[]")
			await put({ type: "song", ref: SONG })
			expect(db.cache.store.has("leaderboard:users")).toBe(false)
		})

		it("follows a refreshed cover without a new pick", async () => {
			await submitSong(userId)
			await storeArt()
			await put({ type: "song", ref: SONG })
			await db.pool.query("UPDATE song_artwork SET artwork_url = $1 WHERE video_id = $2", [
				"https://yt3.googleusercontent.com/new=w544-h544-l90-rj",
				SONG,
			])
			const size = config.avatar.artworkSize
			expect(await resolveAvatarUrl(db.env, KEY)).toBe(
				`https://yt3.googleusercontent.com/new=w${size}-h${size}-l90-rj`
			)
		})

		it("keeps the pick when the submission is deleted later", async () => {
			const lyricId = await submitSong(userId)
			await storeArt()
			await put({ type: "song", ref: SONG })
			await db.pool.query(
				"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2",
				[userId, lyricId]
			)
			expect(await resolveAvatarUrl(db.env, KEY)).toBe(SIZED_ART)
		})

		describe("error paths", () => {
			it("rejects a song someone else submitted with 403 and keeps the prior choice", async () => {
				const other = await seedUser(db, "b".repeat(64))
				await submitSong(other)
				await storeArt()
				await put({ type: "preset", ref: PRESET.id })
				const { status, body } = await put({ type: "song", ref: SONG })
				expect(status).toBe(403)
				expect(body.code).toBe("SONG_NOT_SUBMITTED")
				expect((await choiceOf(KEY)).avatar_ref).toBe(PRESET.id)
			})

			it("rejects a song whose submission was deleted with 403", async () => {
				const lyricId = await submitSong(userId)
				await storeArt()
				await db.pool.query(
					"UPDATE lyrics SET deleted_at = 1, deleted_by_user_id = $1, deleted_by_role = 'submitter' WHERE id = $2",
					[userId, lyricId]
				)
				const { status, body } = await put({ type: "song", ref: SONG })
				expect(status).toBe(403)
				expect(body.code).toBe("SONG_NOT_SUBMITTED")
			})

			it("rejects a submitted song without a cover with 409", async () => {
				await submitSong(userId)
				db.cache.store.set(`artwork:v2:${SONG}`, "__none__")
				const { status, body } = await put({ type: "song", ref: SONG })
				expect(status).toBe(409)
				expect(body.code).toBe("SONG_ARTWORK_UNAVAILABLE")
				expect((await choiceOf(KEY)).avatar_type).toBeNull()
			})

			it.each([["short"], [42], [undefined], [" dQw4w9WgXc"], ["dQw4w9WgXcQ/"]])(
				"rejects a malformed song ref %j with 400",
				async (ref) => {
					const { status, body } = await put({ type: "song", ref })
					expect(status).toBe(400)
					expect(body.code).toBe("INVALID_AVATAR_TYPE")
				}
			)
		})
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
			expect(body.code).toBe("UNKNOWN_AVATAR_PRESET")
			expect((await choiceOf(KEY)).avatar_ref).toBe(PRESET.id)
		})

		it("rejects a preset with no ref with 400", async () => {
			const { status, body } = await put({ type: "preset" })
			expect(status).toBe(400)
			expect(body.code).toBe("UNKNOWN_AVATAR_PRESET")
		})

		it("rejects discord with 409 when no account is linked", async () => {
			const { status, body } = await put({ type: "discord" })
			expect(status).toBe(409)
			expect(body.code).toBe("DISCORD_AVATAR_UNAVAILABLE")
			expect((await choiceOf(KEY)).avatar_type).toBeNull()
		})

		it("rejects discord with 409 when the link has no stored hash yet", async () => {
			await linkDiscord(null)
			const { status, body } = await put({ type: "discord" })
			expect(status).toBe(409)
			expect(body.code).toBe("DISCORD_AVATAR_UNAVAILABLE")
		})

		it("rejects an unknown type with 400", async () => {
			const { status, body } = await put({ type: "upload", ref: "https://example.com/x.png" })
			expect(status).toBe(400)
			expect(body.code).toBe("INVALID_AVATAR_TYPE")
		})

		it("rate limits with the shared error envelope", async () => {
			const blocked = { limit: async () => ({ success: false }) } as unknown as Env["RATE_LIMITER"]
			const limited: Env = { ...db.env, RATE_LIMITER: blocked }
			const res = await avatarRoutes(limited).handle(
				new Request("http://localhost/avatars/me", {
					method: "PUT",
					headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
					body: JSON.stringify({ type: "default" }),
				})
			)
			expect(res.status).toBe(429)
			const body = (await res.json()) as PutResult["body"] & { hint?: string }
			expect(body.code).toBe("RATE_LIMITED")
			expect(body.hint?.length).toBeGreaterThan(0)
		})

		it("rejects a non-string ref with 400", async () => {
			const { status, body } = await put({ type: "preset", ref: 42 })
			expect(status).toBe(400)
			expect(body.code).toBe("UNKNOWN_AVATAR_PRESET")
		})
	})
})

describeIntegration("POST /avatars/presets (integration)", () => {
	let db: IntegrationDb
	let pngBase64: string

	function makeCdn() {
		const puts: { key: string; contentType: string; bytes: number }[] = []
		const deletes: string[] = []
		const storage = {
			async putObject(key: string, body: Buffer, contentType: string) {
				puts.push({ key, contentType, bytes: body.length })
			},
			async listObjects() {
				return []
			},
			async deleteObject(key: string) {
				deletes.push(key)
			},
		} as unknown as NonNullable<Env["CDN"]>
		return { puts, deletes, storage }
	}

	interface PostBody {
		success: boolean
		code?: string
		data?: { id: string; label: string; url: string }
	}

	async function post(
		env: Env,
		body: unknown,
		auth: string | null = BOT_SECRET
	): Promise<{ status: number; body: PostBody }> {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (auth) headers.authorization = `Bearer ${auth}`
		const res = await avatarRoutes(env).handle(
			new Request("http://localhost/avatars/presets", {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			})
		)
		const text = await res.text()
		let parsed: PostBody
		try {
			parsed = JSON.parse(text) as PostBody
		} catch {
			parsed = { success: false }
		}
		return { status: res.status, body: parsed }
	}

	beforeAll(async () => {
		db = await openIntegrationDb()
		const png = await sharp({
			create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 120, b: 40 } },
		})
			.png()
			.toBuffer()
		pngBase64 = png.toString("base64")
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM avatar_presets")
	})

	afterEach(() => {
		setCatalogue([...AVATAR_PRESETS])
	})

	it("formats, uploads, stores, and returns the CDN url", async () => {
		const cdn = makeCdn()
		const env: Env = { ...db.env, CDN: cdn.storage }
		const { status, body } = await post(env, {
			id: "sky-cat",
			label: "Sky Cat",
			createdBy: "k".repeat(64),
			mime: "image/png",
			dataBase64: pngBase64,
		})
		expect(status).toBe(200)
		expect(body.data?.url).toBe(`${config.avatar.cdnBase}sky-cat.webp`)
		expect(cdn.puts).toEqual([
			{ key: "avatars/sky-cat.webp", contentType: "image/webp", bytes: expect.any(Number) },
		])
		const { rows } = await db.pool.query("SELECT id, label, file, created_by FROM avatar_presets")
		expect(rows).toEqual([
			{ id: "sky-cat", label: "Sky Cat", file: "sky-cat.webp", created_by: "k".repeat(64) },
		])
	})

	it("rejects a duplicate id already in the catalogue with 409 and no upload", async () => {
		const cdn = makeCdn()
		const env: Env = { ...db.env, CDN: cdn.storage }
		await post(env, { id: "dupe", label: "Dupe", mime: "image/png", dataBase64: pngBase64 })
		const { status, body } = await post(env, {
			id: "dupe",
			label: "Dupe Two",
			mime: "image/png",
			dataBase64: pngBase64,
		})
		expect(status).toBe(409)
		expect(body.code).toBe("AVATAR_PRESET_EXISTS")
		expect(cdn.puts).toHaveLength(1)
	})

	it("returns 409 for an existing id and never touches the CDN", async () => {
		await insertPreset(db.env, { id: "outofband", label: "Out", file: "outofband.webp" })
		const cdn = makeCdn()
		const env: Env = { ...db.env, CDN: cdn.storage }
		const { status, body } = await post(env, {
			id: "outofband",
			label: "Out",
			mime: "image/png",
			dataBase64: pngBase64,
		})
		expect(status).toBe(409)
		expect(body.code).toBe("AVATAR_PRESET_EXISTS")
		expect(cdn.puts).toHaveLength(0)
		expect(cdn.deletes).toHaveLength(0)
	})

	it("rolls back the reserved row when the CDN upload fails", async () => {
		const failingCdn = {
			async putObject() {
				throw new Error("cdn down")
			},
			async listObjects() {
				return []
			},
			async deleteObject() {},
		} as unknown as NonNullable<Env["CDN"]>
		const env: Env = { ...db.env, CDN: failingCdn }
		const { status } = await post(env, {
			id: "boom-cat",
			label: "Boom",
			mime: "image/png",
			dataBase64: pngBase64,
		})
		expect(status).toBe(500)
		const { rows } = await db.pool.query("SELECT id FROM avatar_presets WHERE id = 'boom-cat'")
		expect(rows).toHaveLength(0)
	})
})
