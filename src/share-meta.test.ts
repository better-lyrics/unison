import type { Env } from "@/types"
import { describe, expect, it } from "vitest"
import { type SongShareInput, sharePage, songShare } from "./share-meta"

const INDEX = `<!doctype html><html><head><meta name="theme-color" content="#28292c" /><title>Unison: Better Lyrics Leaderboards</title><meta name="description" content="Most-wanted songs and top curators for Better Lyrics." /></head><body><div id="root"></div></body></html>`

const env = {} as Env

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

const page = (path: string, share: SongShareInput | null) =>
	sharePage(env, request(path), INDEX, {
		song: async () => (share ? songShare(share, "#d92626") : null),
		profile: async () => null,
	})

describe("share meta", () => {
	it("escapes a hostile title in every tag", async () => {
		const html = await page("/song/BI9HQCzpDgQ", song("</title><script>alert(1)</script>"))
		expect(html).not.toContain("<script>")
		expect(html).toContain("&lt;/title&gt;&lt;script&gt;")
	})

	it("serves the plain app page when the song is missing or the lookup fails", async () => {
		expect(await page("/song/BI9HQCzpDgQ", null)).toBe(INDEX)
		const failing = await sharePage(env, request("/song/BI9HQCzpDgQ"), INDEX, {
			song: async () => {
				throw new Error("db down")
			},
			profile: async () => null,
		})
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
