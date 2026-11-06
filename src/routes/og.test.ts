import { songShare } from "@/share-meta"
import { makeMemoryCache, makeOpenLimiter } from "@/test/integration-harness"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { cardMemoKey, ogRoutes } from "./og"

function makeMockDB() {
	const statement = {
		async first() {
			return null
		},
		async all() {
			return { results: [] }
		},
		async run() {},
	}
	return {
		prepare() {
			return { ...statement, bind: () => statement }
		},
	}
}

const VIDEO = "BI9HQCzpDgQ"
const KEY = "a".repeat(64)

const cache = makeMemoryCache()
cache.store.set(
	`share:song:${VIDEO}`,
	JSON.stringify(
		songShare(
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
	)
)

const limiter = makeOpenLimiter()
const env = {
	DB: makeMockDB() as unknown as Env["DB"],
	CACHE: cache as unknown as Env["CACHE"],
	RATE_LIMITER: limiter as unknown as Env["RATE_LIMITER"],
	READ_RATE_LIMITER: limiter as unknown as Env["READ_RATE_LIMITER"],
	CACHE_TTL_SECONDS: "300",
	DUMPS_ENABLED: false,
	DUMP_PUBLIC_BASE_URL: "",
	DUMP_DATABASE_URL: null,
	B2: null,
	CDN: null,
} as Env

const app = ogRoutes(env)

const get = (path: string) =>
	app.handle(new Request(`http://localhost${path}`, { headers: { host: "unison.test" } }))

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

	it("regression: renders a card once per version, whatever the query string", () => {
		const url = `http://localhost/og/user/${KEY}.jpg`
		expect(cardMemoKey(`${url}?x=1`, "p1")).toBe(cardMemoKey(`${url}?x=2`, "p1"))
		expect(cardMemoKey(`${url}?x=1`, "p2")).not.toBe(cardMemoKey(`${url}?x=1`, "p1"))
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
