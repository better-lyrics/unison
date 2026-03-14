import { Elysia, t } from "elysia"
import { findBySongArtist, findByVideoId } from "@/db/lyrics"
import type { Env } from "@/types"

export const compatRoutes = (env: Env) =>
	new Elysia()
		.decorate("env", env)
		.get(
			"/getLyrics",
			async ({ query, env, status }) => {
				// Try videoId first
				if (query.v) {
					const result = await findByVideoId(env, query.v)
					if (!result) {
						return status(404, { error: "Not found" })
					}
					return { lyrics: result.lyrics, format: result.format }
				}

				// Try song/artist (legacy support)
				const song = query.s || query.song
				const artist = query.a || query.artist
				if (song && artist) {
					const duration =
						query.d || query.duration ? Number(query.d || query.duration) : undefined
					const result = await findBySongArtist(env, song, artist, duration, query.album)
					if (!result) {
						return status(404, { error: "Not found" })
					}
					return { lyrics: result.lyrics, format: result.format }
				}

				return status(400, { error: "Missing parameters" })
			},
			{
				query: t.Object({
					v: t.Optional(t.String()),
					s: t.Optional(t.String()),
					song: t.Optional(t.String()),
					a: t.Optional(t.String()),
					artist: t.Optional(t.String()),
					album: t.Optional(t.String()),
					d: t.Optional(t.String()),
					duration: t.Optional(t.String()),
				}),
			}
		)
