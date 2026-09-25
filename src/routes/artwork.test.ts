import { describe, expect, it } from "vitest"
import type { Env } from "@/types"
import { artworkRoutes } from "./artwork"

function makeEnv(): Env {
	const store = new Map<string, string>()
	const limiter = {
		async limit() {
			return { success: true }
		},
	}
	const cache = {
		async get(k: string) {
			return store.has(k) ? (store.get(k) as string) : null
		},
		async put(k: string, v: string) {
			store.set(k, v)
		},
		async delete(k: string) {
			store.delete(k)
		},
	}
	return {
		DB: {} as unknown as Env["DB"],
		CACHE: cache as unknown as Env["CACHE"],
		RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
		READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
	} as unknown as Env
}

describe("GET /artwork", () => {
	it("returns the resolved artwork url from cache", async () => {
		const env = makeEnv()
		await env.CACHE.put("artwork:v2:dQw4w9WgXcQ", "https://art/x=w544-h544")
		const app = artworkRoutes(env)
		const res = await app.handle(new Request("http://localhost/artwork?v=dQw4w9WgXcQ"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			success: true,
			data: { artworkUrl: "https://art/x=w544-h544" },
		})
	})

	it("returns a null artworkUrl on a negative cache hit", async () => {
		const env = makeEnv()
		await env.CACHE.put("artwork:v2:dQw4w9WgXcQ", "__none__")
		const app = artworkRoutes(env)
		const res = await app.handle(new Request("http://localhost/artwork?v=dQw4w9WgXcQ"))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { artworkUrl: null } })
	})

	describe("size", () => {
		const STORED = "https://yt3.googleusercontent.com/abc=w544-h544-l90-rj"

		async function get(query: string) {
			const env = makeEnv()
			await env.CACHE.put("artwork:v2:dQw4w9WgXcQ", STORED)
			const res = await artworkRoutes(env).handle(
				new Request(`http://localhost/artwork?v=dQw4w9WgXcQ${query}`)
			)
			return {
				status: res.status,
				body: (await res.json()) as { data?: { artworkUrl: string | null } },
			}
		}

		it("resizes the cover when a size is given", async () => {
			const { status, body } = await get("&size=256")
			expect(status).toBe(200)
			expect(body.data?.artworkUrl).toBe("https://yt3.googleusercontent.com/abc=w256-h256-l90-rj")
		})

		it("returns the stored url unchanged without a size", async () => {
			const { body } = await get("")
			expect(body.data?.artworkUrl).toBe(STORED)
		})

		it("accepts the bounds 32 and 1024", async () => {
			expect((await get("&size=32")).body.data?.artworkUrl).toContain("=w32-h32-")
			expect((await get("&size=1024")).body.data?.artworkUrl).toContain("=w1024-h1024-")
		})

		it("keeps a missing cover null when a size is given", async () => {
			const env = makeEnv()
			await env.CACHE.put("artwork:v2:dQw4w9WgXcQ", "__none__")
			const res = await artworkRoutes(env).handle(
				new Request("http://localhost/artwork?v=dQw4w9WgXcQ&size=256")
			)
			expect(await res.json()).toEqual({ success: true, data: { artworkUrl: null } })
		})

		it.each([["31"], ["1025"], ["0"], ["-5"], ["abc"], ["25.5"]])(
			"rejects an out of range or malformed size %s",
			async (size) => {
				expect((await get(`&size=${size}`)).status).toBe(422)
			}
		)
	})

	describe("validation", () => {
		it("400s when v is missing", async () => {
			const app = artworkRoutes(makeEnv())
			const res = await app.handle(new Request("http://localhost/artwork"))
			expect(res.status).toBe(400)
		})

		it("400s when v is not 11 chars", async () => {
			const app = artworkRoutes(makeEnv())
			const res = await app.handle(new Request("http://localhost/artwork?v=short"))
			expect(res.status).toBe(400)
		})

		it("400s when v is 11 chars but has an invalid character", async () => {
			const app = artworkRoutes(makeEnv())
			const res = await app.handle(new Request("http://localhost/artwork?v=!!!!!!!!!!!"))
			expect(res.status).toBe(400)
		})
	})
})
