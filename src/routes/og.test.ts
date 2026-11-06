import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { ogRoutes } from "./og"

const limiter = {
	async limit() {
		return { success: true }
	},
}

const env = {
	DB: {} as unknown as Env["DB"],
	CACHE: {} as unknown as Env["CACHE"],
	RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
	READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
	CACHE_TTL_SECONDS: "300",
	DUMPS_ENABLED: false,
	DUMP_PUBLIC_BASE_URL: "",
	DUMP_DATABASE_URL: null,
	B2: null,
	CDN: null,
} as Env

const VIDEO = "BI9HQCzpDgQ"
const KEY = "a".repeat(64)

function app() {
	const card = async (_env: Env, id: string) =>
		id === VIDEO || id === KEY ? { bytes: Buffer.from("img"), accent: "#d92626" } : null
	return ogRoutes(env, { song: card, profile: card, download: card })
}

const get = (path: string) => app().handle(new Request(`http://localhost${path}`))

describe("share card routes", () => {
	it("rejects an id that is not a video id or key id", async () => {
		expect((await get("/og/song/bad.jpg")).status).toBe(400)
		expect((await get("/og/user/xyz.jpg")).status).toBe(400)
	})

	it("returns 404 for a song or user that does not exist", async () => {
		expect((await get("/og/song/AAAAAAAAAAA.jpg")).status).toBe(404)
		expect((await get(`/card/user/${"b".repeat(64)}.png`)).status).toBe(404)
	})

	it("serves the image with an edge cache header", async () => {
		const song = await get(`/og/song/${VIDEO}.jpg?v=abc`)
		expect(song.status).toBe(200)
		expect(song.headers.get("content-type")).toBe("image/jpeg")
		expect(song.headers.get("cache-control")).toBe(
			"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
		)
		const download = await get(`/card/user/${KEY}.png`)
		expect(download.headers.get("content-type")).toBe("image/png")
	})
})
