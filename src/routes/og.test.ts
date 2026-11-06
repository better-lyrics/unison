import { songShare } from "@/share-meta"
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

let renders = 0
let profileVersion = "p1"

function app() {
	const card = async (_env: Env, id: string) => {
		renders++
		return id === VIDEO || id === KEY ? { bytes: Buffer.from("img"), accent: "#d92626" } : null
	}
	const profile = async (_env: Env, id: string) =>
		id === KEY
			? {
					title: "mukeenanyafiq",
					description: "New curator on Unison",
					themeColor: "#d92626",
					image: `/og/user/${KEY}.jpg?v=${profileVersion}`,
					version: profileVersion,
					author: { name: "New curator", path: `/curator/${KEY}` },
				}
			: null
	const share = async (_env: Env, id: string) =>
		id === VIDEO
			? songShare(
					{
						videoId: VIDEO,
						top: {
							id: 41,
							song: "Paper Lanterns",
							artist: "The Quiet Hours",
							album: null,
							sync_type: "linesync",
							format: "lrc",
							upvotes: 3,
						},
						versions: 1,
						sealed: false,
						person: { displayName: "mukeenanyafiq", avatarUrl: null, keyId: KEY },
						artwork: null,
					},
					"#d92626"
				)
			: null
	return ogRoutes(
		env,
		{ song: card, profile: card, download: card },
		{ song: share, profile }
	)
}

const get = (path: string) =>
	app().handle(new Request(`http://localhost${path}`, { headers: { host: "unison.test" } }))

const oembed = (url: string) => get(`/oembed?format=json&url=${encodeURIComponent(url)}`)

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

	it("regression: renders a card once per version, whatever the query string", async () => {
		const before = renders
		await get(`/og/user/${KEY}.jpg?x=1`)
		await get(`/og/user/${KEY}.jpg?x=2`)
		expect(renders - before).toBe(1)
		profileVersion = "p2"
		await get(`/og/user/${KEY}.jpg?x=1`)
		expect(renders - before).toBe(2)
	})

	it("answers oEmbed only for our own song and profile links", async () => {
		expect((await oembed(`https://evil.example/song/${VIDEO}`)).status).toBe(404)
		expect((await oembed("http://unison.test/sealed")).status).toBe(404)
		const res = await oembed(`http://unison.test/song/${VIDEO}`)
		expect(await res.json()).toMatchObject({
			provider_name: "Unison",
			author_name: "Synced by mukeenanyafiq",
			author_url: `http://unison.test/curator/${KEY}`,
		})
	})
})
