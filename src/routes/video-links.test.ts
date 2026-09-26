import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/db/video-links", () => ({
	linkVideoForOwner: vi.fn(),
	unlinkVideoForOwner: vi.fn(),
	listVideoLinks: vi.fn(),
}))
vi.mock("@/services/video-suggestions", () => ({
	suggestVideosForVariant: vi.fn(),
	suggestVideosForSong: vi.fn(),
}))

import { config } from "@/config"
import { linkVideoForOwner, listVideoLinks, unlinkVideoForOwner } from "@/db/video-links"
import { suggestVideosForSong, suggestVideosForVariant } from "@/services/video-suggestions"
import { canonicalJson, hashPublicKey } from "@/utils/crypto"
import { videoLinkRoutes } from "./video-links"

const KEY = "a".repeat(64)

function makeMockCache() {
	const store: Record<string, string> = {}
	return {
		store,
		async get(k: string) {
			return store[k] ?? null
		},
		async put(k: string, v: string) {
			store[k] = v
		},
		async delete(k: string) {
			delete store[k]
		},
		async keys() {
			return Object.keys(store)
		},
		async setNX(k: string, v: string) {
			if (store[k] !== undefined) return false
			store[k] = v
			return true
		},
	}
}

function makeMockDB(queue: unknown[]) {
	return {
		queue,
		prepare() {
			return {
				bind() {
					return {
						async first<T>() {
							return (queue.shift() as T) ?? null
						},
						async all<T>() {
							return { results: (queue.shift() as T[]) ?? [] }
						},
						async run() {
							queue.shift()
						},
					}
				},
			}
		},
	}
}

function makeEnv(db: ReturnType<typeof makeMockDB>, cache: ReturnType<typeof makeMockCache>): Env {
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	return {
		DB: db as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
		CACHE_TTL_SECONDS: "300",
		DUMPS_ENABLED: false,
		DUMP_PUBLIC_BASE_URL: "",
		DUMP_DATABASE_URL: null,
		B2: null,
		CDN: null,
	} as unknown as Env
}

function seedSession(cache: ReturnType<typeof makeMockCache>, token: string) {
	const issuedAt = Math.floor(Date.now() / 1000)
	cache.store[`session:${token}`] = JSON.stringify({
		keyId: KEY,
		issuedAt,
		expiresAt: issuedAt + 600,
	})
}

function authedApp() {
	const cache = makeMockCache()
	seedSession(cache, "tok")
	const db = makeMockDB([{ id: 42, key_id: KEY }])
	return videoLinkRoutes(makeEnv(db, cache))
}

const post = (id: number, videoId: unknown, headers: Record<string, string> = {}) =>
	new Request(`http://localhost/lyrics/${id}/videos`, {
		method: "POST",
		headers: { authorization: "Bearer tok", "content-type": "application/json", ...headers },
		body: JSON.stringify({ videoId }),
	})

describe("GET /lyrics/:id/videos (public)", () => {
	it("returns the linked videos without auth", async () => {
		vi.mocked(listVideoLinks).mockResolvedValue([
			{ videoId: "dQw4w9WgXcQ", isPrimary: true },
			{ videoId: "9bZkp7q19f0", isPrimary: false },
		])
		const cache = makeMockCache()
		const app = videoLinkRoutes(makeEnv(makeMockDB([]), cache))
		const res = await app.handle(new Request("http://localhost/lyrics/7/videos"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			success: true,
			data: {
				videos: [
					{ videoId: "dQw4w9WgXcQ", isPrimary: true },
					{ videoId: "9bZkp7q19f0", isPrimary: false },
				],
			},
		})
	})
})

describe("POST /lyrics/:id/videos", () => {
	it("links a video for the authenticated owner", async () => {
		vi.mocked(linkVideoForOwner).mockResolvedValue({
			ok: true,
			videos: [{ videoId: "9bZkp7q19f0", isPrimary: false }],
		})
		const res = await authedApp().handle(post(7, "9bZkp7q19f0"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			success: true,
			data: { videos: [{ videoId: "9bZkp7q19f0", isPrimary: false }] },
		})
	})

	it("rejects an unauthenticated request without running the mutation", async () => {
		vi.mocked(linkVideoForOwner).mockClear()
		const app = videoLinkRoutes(makeEnv(makeMockDB([]), makeMockCache()))
		const res = await app.handle(
			new Request("http://localhost/lyrics/7/videos", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ videoId: "9bZkp7q19f0" }),
			})
		)
		expect(res.status).toBeGreaterThanOrEqual(400)
		expect(vi.mocked(linkVideoForOwner)).not.toHaveBeenCalled()
	})

	it("rejects a missing videoId with 400", async () => {
		const res = await authedApp().handle(post(7, undefined))
		expect(res.status).toBe(400)
	})

	it("returns 429 when the rate limiter rejects, without running the mutation", async () => {
		vi.mocked(linkVideoForOwner).mockClear()
		const cache = makeMockCache()
		seedSession(cache, "tok")
		const env = makeEnv(makeMockDB([{ id: 42, key_id: KEY }]), cache)
		env.RATE_LIMITER = {
			async limit() {
				return { success: false }
			},
		} as unknown as Env["RATE_LIMITER"]
		const res = await videoLinkRoutes(env).handle(post(7, "9bZkp7q19f0"))
		expect(res.status).toBe(429)
		expect(vi.mocked(linkVideoForOwner)).not.toHaveBeenCalled()
	})

	describe("error mapping", () => {
		const cases: Array<[Awaited<ReturnType<typeof linkVideoForOwner>> & { ok: false }, number]> = [
			[{ ok: false, reason: "not_owner" }, 403],
			[{ ok: false, reason: "not_found" }, 404],
			[{ ok: false, reason: "duration_mismatch" }, 422],
			[{ ok: false, reason: "unverifiable" }, 422],
			[{ ok: false, reason: "cap_reached" }, 409],
		]
		for (const [result, expected] of cases) {
			it(`maps ${result.reason} to ${expected}`, async () => {
				vi.mocked(linkVideoForOwner).mockResolvedValue(result)
				const res = await authedApp().handle(post(7, "9bZkp7q19f0"))
				expect(res.status).toBe(expected)
			})
		}
	})
})

describe("POST /lyrics/:id/suggested-videos", () => {
	it("returns ranked suggestions for the owner", async () => {
		vi.mocked(suggestVideosForVariant).mockResolvedValue({
			ok: true,
			suggestions: [
				{
					videoId: "exactmatch1",
					title: "Song",
					artist: "Artist",
					artists: ["Artist"],
					artistChannelIds: ["UCartist"],
					album: null,
					durationSeconds: 200,
					videoType: "song",
					artworkUrl: null,
					matchScore: 1,
				},
			],
		})
		const res = await authedApp().handle(
			new Request("http://localhost/lyrics/7/suggested-videos", {
				method: "POST",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { data: { suggestions: Array<{ videoId: string }> } }
		expect(body.data.suggestions[0].videoId).toBe("exactmatch1")
	})

	it("rejects a non-owner with 403", async () => {
		vi.mocked(suggestVideosForVariant).mockResolvedValue({ ok: false, reason: "not_owner" })
		const res = await authedApp().handle(
			new Request("http://localhost/lyrics/7/suggested-videos", {
				method: "POST",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(403)
	})

	it("returns 429 when the rate limiter rejects, without running the suggestion", async () => {
		vi.mocked(suggestVideosForVariant).mockClear()
		const cache = makeMockCache()
		seedSession(cache, "tok")
		const env = makeEnv(makeMockDB([{ id: 42, key_id: KEY }]), cache)
		env.RATE_LIMITER = {
			async limit() {
				return { success: false }
			},
		} as unknown as Env["RATE_LIMITER"]
		const res = await videoLinkRoutes(env).handle(
			new Request("http://localhost/lyrics/7/suggested-videos", {
				method: "POST",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(429)
		expect(vi.mocked(suggestVideosForVariant)).not.toHaveBeenCalled()
	})
})

describe("POST /lyrics/suggested-videos", () => {
	const SUGGESTION = {
		videoId: "4NRXx6U8ABQ",
		title: "Blinding Lights",
		artist: "The Weeknd",
		artists: ["The Weeknd"],
		artistChannelIds: ["UCweeknd"],
		album: null,
		durationSeconds: 201,
		videoType: "video" as const,
		artworkUrl: null,
		matchScore: 0.8,
	}
	const VALID = {
		song: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		duration: 200,
		videoId: "fHI8X4OXluQ",
	}

	const suggestFor = (body: unknown, app = authedApp()) =>
		app.handle(
			new Request("http://localhost/lyrics/suggested-videos", {
				method: "POST",
				headers: { authorization: "Bearer tok", "content-type": "application/json" },
				body: JSON.stringify(body),
			})
		)

	it("returns suggestions for a song that has not been submitted yet", async () => {
		vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([SUGGESTION])
		const res = await suggestFor(VALID)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { suggestions: [SUGGESTION] } })
		expect(vi.mocked(suggestVideosForSong)).toHaveBeenCalledWith(expect.anything(), VALID)
	})

	it("accepts a request without album or videoId", async () => {
		vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([])
		const res = await suggestFor({ song: "Blinding Lights", artist: "The Weeknd", duration: 200 })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { suggestions: [] } })
		expect(vi.mocked(suggestVideosForSong)).toHaveBeenCalledWith(expect.anything(), {
			song: "Blinding Lights",
			artist: "The Weeknd",
			album: null,
			duration: 200,
			videoId: undefined,
		})
	})

	it("accepts a signed request and reads the song from the payload", async () => {
		vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([SUGGESTION])
		const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])
		const publicJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey
		const keyId = await hashPublicKey(publicJwk)
		const payload = { timestamp: Date.now(), nonce: "n".repeat(32), keyId, ...VALID }
		const sig = await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			kp.privateKey,
			new TextEncoder().encode(canonicalJson(payload))
		)
		const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
		const db = makeMockDB([
			{ key_id: keyId, public_key: JSON.stringify(publicJwk), created_at: 0 },
			{ id: 42, key_id: keyId },
		])
		const res = await videoLinkRoutes(makeEnv(db, makeMockCache())).handle(
			new Request("http://localhost/lyrics/suggested-videos", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ payload, signature }),
			})
		)
		expect(res.status).toBe(200)
		expect(vi.mocked(suggestVideosForSong)).toHaveBeenCalledWith(expect.anything(), VALID)
	})

	it("rate limits per key on the suggest bucket, like the owner route", async () => {
		vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([])
		const cache = makeMockCache()
		seedSession(cache, "tok")
		const env = makeEnv(makeMockDB([{ id: 42, key_id: KEY }]), cache)
		const limit = vi.fn(async () => ({ success: false }))
		env.RATE_LIMITER = { limit } as unknown as Env["RATE_LIMITER"]
		const res = await suggestFor(VALID, videoLinkRoutes(env))
		expect(res.status).toBe(429)
		expect(limit).toHaveBeenCalledWith({
			key: `suggest:${KEY}`,
			maxRequests: config.rateLimit.suggest.maxRequests,
			windowSeconds: config.rateLimit.suggest.windowSeconds,
		})
		expect(vi.mocked(suggestVideosForSong)).not.toHaveBeenCalled()
	})

	it("requires auth", async () => {
		vi.mocked(suggestVideosForSong).mockReset()
		const res = await videoLinkRoutes(makeEnv(makeMockDB([]), makeMockCache())).handle(
			new Request("http://localhost/lyrics/suggested-videos", { method: "POST" })
		)
		expect(res.status).toBe(401)
		expect(vi.mocked(suggestVideosForSong)).not.toHaveBeenCalled()
	})

	describe("routing", () => {
		it("does not fall through to the owner route for a lyric id", async () => {
			vi.mocked(suggestVideosForVariant).mockClear()
			vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([])
			const res = await suggestFor(VALID)
			expect(res.status).toBe(200)
			expect(vi.mocked(suggestVideosForVariant)).not.toHaveBeenCalled()
		})
	})

	describe("validation", () => {
		const invalid: Array<[string, unknown]> = [
			["a missing song", { ...VALID, song: undefined }],
			["an empty song", { ...VALID, song: "" }],
			["a whitespace-only song", { ...VALID, song: "   " }],
			["a non-string song", { ...VALID, song: 42 }],
			["a missing artist", { ...VALID, artist: undefined }],
			["an empty artist", { ...VALID, artist: "" }],
			[
				"a song over the length cap",
				{ ...VALID, song: "x".repeat(config.validation.song.maxLength + 1) },
			],
			[
				"an artist over the length cap",
				{ ...VALID, artist: "x".repeat(config.validation.artist.maxLength + 1) },
			],
			["a non-string album", { ...VALID, album: 7 }],
			["a missing duration", { ...VALID, duration: undefined }],
			["a string duration", { ...VALID, duration: "200" }],
			["a duration below the minimum", { ...VALID, duration: config.validation.duration.min - 1 }],
			["a duration above the maximum", { ...VALID, duration: config.validation.duration.max + 1 }],
			["a short videoId", { ...VALID, videoId: "fHI8X4OXlu" }],
			["a long videoId", { ...VALID, videoId: "fHI8X4OXluQQ" }],
			["a non-string videoId", { ...VALID, videoId: 12345678901 }],
		]
		for (const [label, body] of invalid) {
			it(`rejects ${label} with 400 INVALID_PAYLOAD`, async () => {
				vi.mocked(suggestVideosForSong).mockReset()
				const res = await suggestFor(body)
				expect(res.status).toBe(400)
				expect(((await res.json()) as { code: string }).code).toBe("INVALID_PAYLOAD")
				expect(vi.mocked(suggestVideosForSong)).not.toHaveBeenCalled()
			})
		}

		it("accepts the duration bounds themselves", async () => {
			vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([])
			for (const duration of [config.validation.duration.min, config.validation.duration.max]) {
				expect((await suggestFor({ ...VALID, duration })).status).toBe(200)
			}
		})

		it("accepts unicode song and artist names", async () => {
			vi.mocked(suggestVideosForSong).mockReset().mockResolvedValue([])
			const res = await suggestFor({ ...VALID, song: "夜に駆ける", artist: "YOASOBI" })
			expect(res.status).toBe(200)
		})
	})
})

describe("DELETE /lyrics/:id/videos/:videoId", () => {
	it("unlinks for the owner", async () => {
		vi.mocked(unlinkVideoForOwner).mockResolvedValue({
			ok: true,
			videos: [{ videoId: "dQw4w9WgXcQ", isPrimary: true }],
		})
		const res = await authedApp().handle(
			new Request("http://localhost/lyrics/7/videos/9bZkp7q19f0", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(200)
	})

	it("refuses to unlink the primary with 409", async () => {
		vi.mocked(unlinkVideoForOwner).mockResolvedValue({ ok: false, reason: "cannot_unlink_primary" })
		const res = await authedApp().handle(
			new Request("http://localhost/lyrics/7/videos/dQw4w9WgXcQ", {
				method: "DELETE",
				headers: { authorization: "Bearer tok" },
			})
		)
		expect(res.status).toBe(409)
	})
})
