import { describe, expect, it } from "vitest"
import { lyricEtag, matchesEtag } from "./lyric-etag"

const lyric = {
	id: 13529,
	videoId: "Ugr4KKK_SqY",
	song: "Night Drive",
	artist: "Example Artist",
	album: "Example Album",
	isrc: "FR8EU2300090",
	language: "en",
	format: "lrc" as const,
	lyrics: "[00:01.00] Headlights on the wet road\n[00:05.00] Nobody else awake",
	score: 3,
	voteCount: 4,
}

describe("lyricEtag", () => {
	it("stays the same when only votes change", () => {
		const revoted = { ...lyric, score: 9, voteCount: 12 }
		expect(lyricEtag(revoted)).toBe(lyricEtag(lyric))
	})

	it("changes when the lyric text or another version changes", () => {
		const etag = lyricEtag(lyric)
		expect(lyricEtag({ ...lyric, lyrics: `${lyric.lyrics}\n[00:09.00] Keep driving` })).not.toBe(
			etag
		)
		expect(lyricEtag({ ...lyric, song: "Night Drive (Live)" })).not.toBe(etag)
		expect(lyricEtag({ ...lyric, id: 13530 })).not.toBe(etag)
		const credited = { ...lyric, submitter: { keyId: "a80e8e35", displayName: "boidu" } }
		const renamed = { ...credited, submitter: { keyId: "a80e8e35", displayName: "boidu2" } }
		expect(lyricEtag(renamed)).not.toBe(lyricEtag(credited))
		expect(lyricEtag({ ...lyric, variant: "own" })).not.toBe(
			lyricEtag({ ...lyric, variant: "primary" })
		)
	})
})

describe("matchesEtag", () => {
	const etag = lyricEtag(lyric)

	it("matches the tag in a list, with or without the weak prefix", () => {
		expect(matchesEtag(`"other", ${etag}`, etag)).toBe(true)
		expect(matchesEtag(etag.replace(/^W\//, ""), etag)).toBe(true)
		expect(matchesEtag("*", etag)).toBe(true)
	})

	it("refuses a missing or different tag", () => {
		expect(matchesEtag(undefined, etag)).toBe(false)
		expect(matchesEtag('W/"13529-stale"', etag)).toBe(false)
	})
})
