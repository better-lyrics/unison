import { submitLyrics } from "@/db/lyrics"
import { lyricsRoutes } from "@/routes/lyrics"
import { revisionRoutes } from "@/routes/revisions"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import type { LyricsResponse, LyricsSubmission, RevisionSummary } from "@/types"
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
		app = new Elysia().use(lyricsRoutes(db.env)).use(revisionRoutes(db.env))
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

	describe("editors", () => {
		const HARBOUR_LINES = [
			"Lanterns swing above the harbour wall",
			"Gulls are counting boats that never call",
			"Salt is drying on the morning rope",
			"Every sailor keeps a pocket full of hope",
			"Tide comes walking up the cobbled street",
			"Fishmongers singing to the beat",
			"Bells are ringing out across the bay",
			"Nobody is leaving here today",
			"Clouds are folding over distant hills",
			"Quiet settles on the window sills",
		]
		const harbour = (lines: string[]) =>
			lines.map((line, i) => `[00:${String(i * 4 + 1).padStart(2, "0")}.00] ${line}`).join("\n")
		const HARBOUR: LyricsSubmission = {
			...SHADOWS,
			videoId: "Ugr4KKK_SqY",
			song: "Harbour Lights",
			artist: "Example Artist",
			album: undefined,
			isrc: undefined,
			lyrics: harbour(HARBOUR_LINES),
		}

		const post = async <T>(path: string, token: string, body: unknown) => {
			const res = await app.handle(
				new Request(`http://localhost${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
					body: JSON.stringify(body),
				})
			)
			return (await res.json()) as { data: T }
		}
		const lookup = async (videoId: string) =>
			(await get(`v=${videoId}`)).body as { data: LyricsResponse }

		it("credits a stranger whose suggestion went live and leaves an unedited lyric bare", async () => {
			const editorKey = "e".repeat(64)
			const editor = await seedUser(db, editorKey)
			await submitLyrics(db.env, { ...HARBOUR, videoId: "dvgZkm1xWPE" }, editor)
			const lyric = await submitLyrics(db.env, HARBOUR, submitter)
			seedSession(db, "editor-token", editorKey)
			seedSession(db, "owner-token", "lookup-submitter")

			const fixed = HARBOUR_LINES.map((line, i) =>
				i === 5 ? "Fishmongers humming to the beat" : line
			)
			const saved = await post<{ revision: RevisionSummary }>(
				`/lyrics/${lyric.id}/revisions`,
				"editor-token",
				{ lyrics: harbour(fixed), format: "lrc", language: "en" }
			)
			await post(
				`/lyrics/${lyric.id}/revisions/${saved.data.revision.id}/approve`,
				"owner-token",
				{}
			)

			expect((await lookup("Ugr4KKK_SqY")).data.editors).toEqual([
				{ keyId: editorKey, displayName: expect.any(String), avatarUrl: null },
			])
			expect((await lookup("lkW3jsz0Gnc")).data.editors).toBeUndefined()
		})
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

	describe("etag", () => {
		it("answers a repeat lookup with 304 and no body while the lyric is unchanged", async () => {
			for (const query of ["v=lkW3jsz0Gnc", "isrc=US2S70465012"]) {
				const url = `http://localhost/lyrics?${query}`
				const first = await app.handle(new Request(url))
				const etag = first.headers.get("etag")
				expect(etag).toMatch(/^W\//)
				// Browsers must not revalidate on their own and hand back old votes; apps opt in with If-None-Match.
				expect(first.headers.get("cache-control")).toBe("no-store")

				const repeat = await app.handle(
					new Request(url, { headers: { "if-none-match": etag ?? "" } })
				)
				expect(repeat.status).toBe(304)
				expect(repeat.headers.get("etag")).toBe(etag)
				expect(repeat.headers.get("vary")).toBe("Origin, Accept-Encoding")
				expect(await repeat.text()).toBe("")
			}
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
