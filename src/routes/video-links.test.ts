import type { Env } from "@/types"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/db/video-links", () => ({
	linkVideoForOwner: vi.fn(),
	unlinkVideoForOwner: vi.fn(),
	listVideoLinks: vi.fn(),
}))
vi.mock("@/services/video-suggestions", () => ({
	suggestVideosForVariant: vi.fn(),
}))
vi.mock("@/db/lyrics", () => ({
	editLyrics: vi.fn(),
}))

import { editLyrics } from "@/db/lyrics"
import { linkVideoForOwner, listVideoLinks, unlinkVideoForOwner } from "@/db/video-links"
import { suggestVideosForVariant } from "@/services/video-suggestions"
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
					album: null,
					durationSeconds: 200,
					videoType: "song",
					matchScore: 1,
					withinDurationDelta: true,
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

describe("POST /lyrics/:id/edit", () => {
	const editReq = (id: number, bodyObj: unknown) =>
		new Request(`http://localhost/lyrics/${id}/edit`, {
			method: "POST",
			headers: { authorization: "Bearer tok", "content-type": "application/json" },
			body: JSON.stringify(bodyObj),
		})

	it("creates an edited variant for the owner", async () => {
		vi.mocked(editLyrics).mockResolvedValue({ ok: true, id: 100 })
		const res = await authedApp().handle(editReq(7, { lyrics: "line a\nline b", format: "plain" }))
		expect(res.status).toBe(201)
		expect(await res.json()).toEqual({ success: true, data: { id: 100, created: true } })
	})

	it("rejects a missing lyrics body with 400", async () => {
		vi.mocked(editLyrics).mockClear()
		const res = await authedApp().handle(editReq(7, { format: "plain" }))
		expect(res.status).toBe(400)
		expect(vi.mocked(editLyrics)).not.toHaveBeenCalled()
	})

	it("maps not_found to 404", async () => {
		vi.mocked(editLyrics).mockResolvedValue({ ok: false, reason: "not_found" })
		const res = await authedApp().handle(editReq(7, { lyrics: "line a\nline b", format: "plain" }))
		expect(res.status).toBe(404)
	})

	it("maps cap_reached to 409", async () => {
		vi.mocked(editLyrics).mockResolvedValue({ ok: false, reason: "cap_reached" })
		const res = await authedApp().handle(editReq(7, { lyrics: "line a\nline b", format: "plain" }))
		expect(res.status).toBe(409)
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
