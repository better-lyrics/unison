import sharp from "sharp"
import { artworkCacheKey } from "@/services/artwork"
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { setProfileSettings } from "@/db/profile-settings"
import {
	describeIntegration,
	type IntegrationDb,
	openIntegrationDb,
	seedLyric,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { renderProfileDownload, renderProfileOg, renderSongOg } from "./render"

const MAX_OG_BYTES = 600 * 1024
const KEY_ID = "7c1e9a04b2d35f6e8a9b0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7"
const VIDEOS = ["q3Fv8LkP0sA", "Zt7mW2xYc4Q", "Hb1nR6pQe9U"]
const ART_URL = (videoId: string) =>
	`https://lh3.googleusercontent.com/${videoId}-art=w544-h544-l90-rj`

async function coverArt(seed: string): Promise<Buffer> {
	const hue = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 90) % 360},50%,20%)"/></linearGradient></defs><rect width="544" height="544" fill="url(#g)"/><circle cx="360" cy="200" r="120" fill="hsl(${(hue + 180) % 360},80%,70%)"/></svg>`
	return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

describeIntegration("share card renderer (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		vi.stubGlobal("fetch", async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input)
			const cover = url.match(/googleusercontent\.com\/([\w-]{11})-art=/)
			if (!cover) throw new Error(`unexpected fetch: ${url}`)
			return new Response(await coverArt(cover[1]))
		})
		db = await openIntegrationDb()
		await wipeRevisionData(db)
		await db.pool.query("DELETE FROM song_artwork")
		const userId = await seedUser(db, KEY_ID)
		for (const videoId of VIDEOS) {
			await seedLyric(db, userId, {
				lyrics: "[00:01.00]Lanterns drift across the harbour",
				format: "lrc",
				videoId,
				album: "Low Tide Letters",
			})
			db.cache.store.set(artworkCacheKey(videoId), ART_URL(videoId))
		}
		await setProfileSettings(db.env, KEY_ID, { banner: VIDEOS[0] })
	})

	afterAll(async () => {
		vi.unstubAllGlobals()
		await db.pool.end()
	})

	it("renders the song card as a 1200x630 JPEG small enough for every unfurler", async () => {
		const card = await renderSongOg(db.env, VIDEOS[0])
		const meta = await sharp(card?.bytes).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630])
		expect(card?.bytes.length).toBeLessThan(MAX_OG_BYTES)
	}, 30_000)

	it("renders the profile card as a 1200x630 JPEG small enough for every unfurler", async () => {
		const card = await renderProfileOg(db.env, KEY_ID)
		const meta = await sharp(card?.bytes).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630])
		expect(card?.bytes.length).toBeLessThan(MAX_OG_BYTES)
	}, 30_000)

	it("renders the profile download card as a 5:7 PNG", async () => {
		const card = await renderProfileDownload(db.env, KEY_ID)
		const meta = await sharp(card?.bytes).metadata()
		expect(meta.format).toBe("png")
		expect((meta.width ?? 0) * 7).toBe((meta.height ?? 0) * 5)
	}, 30_000)
})
