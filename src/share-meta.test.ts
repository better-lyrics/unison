import { makeMemoryCache } from "@/test/integration-harness"
import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { type SongShareInput, pageShare, sharePage, songShare } from "./share-meta"

const INDEX = `<!doctype html><html><head><meta name="theme-color" content="#28292c" /><title>Unison: Better Lyrics Leaderboards</title><meta name="description" content="Most-wanted songs and top curators for Better Lyrics." /></head><body><div id="root"></div></body></html>`

const song = (title: string): SongShareInput => ({
	videoId: "BI9HQCzpDgQ",
	top: {
		id: 41,
		song: title,
		artist: "The Quiet Hours",
		album: "Paper Lanterns",
		sync_type: "richsync",
		format: "ttml",
		upvotes: 12,
	},
	versions: 2,
	sealed: true,
	person: { displayName: "mukeenanyafiq", avatarUrl: null, keyId: "a".repeat(64) },
	artwork: "https://lh3.googleusercontent.com/cover=w544-h544",
})

const request = (path: string) =>
	new Request(`http://localhost${path}`, {
		headers: { host: "unison.betterlyrics.org", "x-forwarded-proto": "https" },
	})

const page = (path: string, share: SongShareInput | null) => {
	const cache = makeMemoryCache()
	cache.store.set(
		"share:song:BI9HQCzpDgQ",
		JSON.stringify(share ? songShare(share, "#d92626") : null)
	)
	cache.store.set(
		"share:page:home",
		JSON.stringify(pageShare({ page: "home", lyrics: 15885, top: [] }, "#28292c"))
	)
	return sharePage({ CACHE: cache } as unknown as Env, request(path), INDEX)
}

describe("share meta", () => {
	it("escapes a hostile title in every tag", async () => {
		const html = await page("/song/BI9HQCzpDgQ", song("</title><script>alert(1)</script>"))
		expect(html).not.toContain("<script>")
		expect(html).toContain("&lt;/title&gt;&lt;script&gt;")
	})

	it("falls back to the home card when the song is missing, and to the plain page on failure", async () => {
		const missing = await page("/song/BI9HQCzpDgQ", null)
		expect(missing).toMatch(/<meta property="og:image" content="[^"]+\/og\/page\/home\.jpg\?v=/)
		const down = {
			CACHE: {
				get: async () => {
					throw new Error("redis down")
				},
			},
		} as unknown as Env
		const failing = await sharePage(down, request("/song/BI9HQCzpDgQ"), INDEX)
		expect(failing).toBe(INDEX)
	})

	it("describes the song card for link previews", async () => {
		const html = await page("/song/BI9HQCzpDgQ", song("Paper Lanterns"))
		expect(html).toContain(
			'<meta property="og:title" content="Paper Lanterns · The Quiet Hours" />'
		)
		expect(html).toContain('<meta name="theme-color" content="#d92626" />')
		expect(html).toMatch(
			/<meta property="og:image" content="https:\/\/unison\.betterlyrics\.org\/og\/song\/BI9HQCzpDgQ\.jpg\?v=[\w-]+" \/>/
		)
		expect(html.match(/<title>/g)).toHaveLength(1)
	})
})
