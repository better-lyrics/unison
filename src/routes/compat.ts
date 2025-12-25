import { findBySongArtist, findByVideoId } from "@/db/lyrics"
import { SongArtistQuerySchema, VideoIdQuerySchema } from "@/schemas"
import type { Env } from "@/types"
import { type } from "arktype"
import { Hono } from "hono"

const compat = new Hono<{ Bindings: Env }>()

compat.get("/getLyrics", async (c) => {
	// Try videoId first
	const videoQuery = VideoIdQuerySchema({ v: c.req.query("v") })
	if (!(videoQuery instanceof type.errors)) {
		const result = await findByVideoId(c.env, videoQuery.v)
		if (!result) {
			return c.json({ error: "Not found" }, 404)
		}
		return c.json({ lyrics: result.lyrics, format: result.format })
	}

	// Try song/artist (legacy support)
	const songQuery = SongArtistQuerySchema({
		song: c.req.query("s") || c.req.query("song"),
		artist: c.req.query("a") || c.req.query("artist"),
		duration: c.req.query("d") || c.req.query("duration"),
	})
	if (!(songQuery instanceof type.errors)) {
		const result = await findBySongArtist(
			c.env,
			songQuery.song,
			songQuery.artist,
			songQuery.duration
		)
		if (!result) {
			return c.json({ error: "Not found" }, 404)
		}
		return c.json({ lyrics: result.lyrics, format: result.format })
	}

	return c.json({ error: "Missing parameters" }, 400)
})

export default compat
