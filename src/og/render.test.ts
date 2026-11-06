import type { Env } from "@/types"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { renderProfileDownload, renderProfileOg, renderSongOg } from "./render"

const MAX_OG_BYTES = 600 * 1024
const VIDEO_ID = "q3Fv8LkP0sA"
const KEY_ID = "7c1e9a04b2d35f6e8a9b0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7"
const ART_URL = (videoId: string) =>
	`https://lh3.googleusercontent.com/${videoId}-art=w544-h544-l90-rj`

type Rule = [RegExp, () => unknown[]]

function makeEnv(rules: Rule[], cache: Record<string, string>): Env {
	const answer = (sql: string) => rules.find(([pattern]) => pattern.test(sql))?.[1]() ?? []
	const statement = (sql: string) => ({
		async first<T>() {
			return (answer(sql)[0] as T) ?? null
		},
		async all<T>() {
			return { results: answer(sql) as T[] }
		},
		async run() {},
	})
	const store = { ...cache }
	return {
		DB: {
			prepare: (sql: string) => ({ ...statement(sql), bind: () => statement(sql) }),
		} as unknown as Env["DB"],
		CACHE: {
			async get(key: string) {
				return store[key] ?? null
			},
			async put(key: string, value: string) {
				store[key] = value
			},
			async delete(key: string) {
				delete store[key]
			},
		} as unknown as Env["CACHE"],
	} as Env
}

const lyric = {
	id: 31,
	video_id: VIDEO_ID,
	song: "Paper Lanterns Over the Harbour",
	artist: "The Quiet Hours",
	album: "Low Tide Letters",
	format: "ttml",
	sync_type: "richsync",
	vote_count: 18,
	submitter_id: 4,
	committee_approved_at: 1_762_000_000,
	committee_approved_by: 9,
	lyrics: "",
}

const env = makeEnv(
	[
		[/FROM lyrics l\s+LEFT JOIN users u ON l.submitter_id/, () => [lyric, { ...lyric, id: 32 }]],
		[/WHERE u\.id = ANY/, () => [{ id: 4, key_id: KEY_ID, nickname: "harbourlights" }]],
		[/SELECT \* FROM users WHERE key_id/, () => [{ id: 4, key_id: KEY_ID }]],
		[
			/SELECT id, featured_badges FROM users WHERE key_id/,
			() => [{ id: 4, featured_badges: null }],
		],
		[
			/SELECT u\.nickname, u\.nickname_lower/,
			() => [{ nickname: "harbourlights", nickname_lower: "harbourlights" }],
		],
		[/SELECT u\.banner_video_id/, () => [{ banner_video_id: VIDEO_ID, banner_live: true }]],
		[
			/FROM lyrics l\s+JOIN users u ON u\.id = l\.submitter_id/,
			() => ["q3Fv8LkP0sA", "Zt7mW2xYc4Q", "Hb1nR6pQe9U"].map((id, i) => ({ id: i, video_id: id })),
		],
	],
	{
		"leaderboard:users:board:5000": JSON.stringify([
			{
				keyId: KEY_ID,
				rank: 40,
				community: false,
				tier: "lyricist",
				submissionCount: 3,
				totalUpvotes: 1420,
			},
		]),
		[`artwork:v2:${VIDEO_ID}`]: ART_URL(VIDEO_ID),
		"artwork:v2:Zt7mW2xYc4Q": ART_URL("Zt7mW2xYc4Q"),
		"artwork:v2:Hb1nR6pQe9U": ART_URL("Hb1nR6pQe9U"),
	}
)

async function coverArt(seed: string): Promise<Buffer> {
	const hue = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 90) % 360},50%,20%)"/></linearGradient></defs><rect width="544" height="544" fill="url(#g)"/><circle cx="360" cy="200" r="120" fill="hsl(${(hue + 180) % 360},80%,70%)"/></svg>`
	return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

const realFetch = globalThis.fetch

beforeAll(() => {
	vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input)
		const cover = url.match(/googleusercontent\.com\/([\w-]{11})-art=/)
		if (cover) return new Response(await coverArt(cover[1]))
		return realFetch(input, init)
	})
})

afterAll(() => {
	vi.unstubAllGlobals()
})

describe("share card renderer", () => {
	it("renders the song card as a 1200x630 JPEG small enough for every unfurler", async () => {
		const card = await renderSongOg(env, VIDEO_ID)
		const meta = await sharp(card?.bytes).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630])
		expect(card?.bytes.length).toBeLessThan(MAX_OG_BYTES)
	}, 30_000)

	it("renders the profile card as a 1200x630 JPEG small enough for every unfurler", async () => {
		const card = await renderProfileOg(env, KEY_ID)
		const meta = await sharp(card?.bytes).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630])
		expect(card?.bytes.length).toBeLessThan(MAX_OG_BYTES)
	}, 30_000)

	it("renders the profile download card as a 5:7 PNG", async () => {
		const card = await renderProfileDownload(env, KEY_ID)
		const meta = await sharp(card?.bytes).metadata()
		expect(meta.format).toBe("png")
		expect((meta.width ?? 0) * 7).toBe((meta.height ?? 0) * 5)
	}, 30_000)
})
