import { submitLyrics } from "@/db/lyrics"
import { lyricsRoutes } from "@/routes/lyrics"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import type { LyricsSubmission } from "@/types"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const SHADOWS: LyricsSubmission = {
	videoId: "lkW3jsz0Gnc",
	song: "Shadows of Tomorrow (feat. Quasimoto)",
	artist: "Madvillain, Madlib, MF Doom",
	album: "Madvillainy",
	isrc: "US2S70465012",
	duration: 156,
	lyrics: "[00:01.00] Today is forever\n[00:05.00] Tomorrow is today",
	format: "lrc",
	syncType: "linesync",
	language: "en",
}

describeIntegration("GET /lyrics lookups (integration)", () => {
	let db: IntegrationDb
	let app: { handle: (req: Request) => Promise<Response> }
	let submitter: number

	const get = async (query: string) => {
		const res = await app.handle(new Request(`http://localhost/lyrics?${query}`))
		return { status: res.status, body: (await res.json()) as { data?: { videoId: string } } }
	}

	beforeAll(async () => {
		db = await openIntegrationDb()
		app = new Elysia().use(lyricsRoutes(db.env))
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		submitter = await seedUser(db, "lookup-submitter")
		await submitLyrics(db.env, SHADOWS, submitter)
	})

	describe("regressions", () => {
		it("regression: resolves the reported partial-credit song/artist lookup", async () => {
			const { status, body } = await get(
				"song=Shadows+of+Tomorrow+(feat.+Quasimoto)&artist=Madvillain%20Madlib&album=Madvillainy&duration=156"
			)

			expect(status).toBe(200)
			expect(body.data?.videoId).toBe("lkW3jsz0Gnc")
		})
	})

	describe("isrc", () => {
		it("finds a lyric by ISRC", async () => {
			const { status, body } = await get("isrc=US2S70465012")

			expect(status).toBe(200)
			expect(body.data?.videoId).toBe("lkW3jsz0Gnc")
		})

		it("accepts a lowercase or hyphenated ISRC", async () => {
			for (const isrc of ["us2s70465012", "US-2S7-04-65012"]) {
				expect((await get(`isrc=${isrc}`)).body.data?.videoId, isrc).toBe("lkW3jsz0Gnc")
			}
		})

		it("falls back to song and artist when the ISRC is unknown", async () => {
			const { status, body } = await get(
				"isrc=GBAYE0800346&song=Shadows+of+Tomorrow&artist=Madvillain"
			)

			expect(status).toBe(200)
			expect(body.data?.videoId).toBe("lkW3jsz0Gnc")
		})

		it("prefers the video id over the ISRC", async () => {
			const other = { ...SHADOWS, videoId: "dvgZkm1xWPE", isrc: "GBAYE0800346" }
			await submitLyrics(db.env, other, submitter)

			const { body } = await get("v=dvgZkm1xWPE&isrc=US2S70465012")

			expect(body.data?.videoId).toBe("dvgZkm1xWPE")
		})

		describe("error paths", () => {
			it("returns 404 for an unknown ISRC with no fallback", async () => {
				expect((await get("isrc=GBAYE0800346")).status).toBe(404)
			})

			it("returns 404 for a blank ISRC", async () => {
				expect((await get("isrc=%20-%20")).status).toBe(404)
			})

			it("still returns 400 with no lookup parameters", async () => {
				expect((await get("album=Madvillainy")).status).toBe(400)
			})
		})
	})
})
