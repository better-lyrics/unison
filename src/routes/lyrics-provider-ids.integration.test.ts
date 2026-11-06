import { config } from "@/config"
import { submitLyrics } from "@/db/lyrics"
import { lookupIsrcVideo, resolveProviderIds } from "@/infra/binilink"
import { lyricsRoutes } from "@/routes/lyrics"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import type { LyricsSubmission } from "@/types"
import { isVideoId } from "@/utils/video-id"
import { Elysia } from "elysia"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const SPOTIFY_ID = "4uLU6hMCjMI75M1A2tKUQC"
const APPLE_ID = "1440857781"
const SEALED_ISRC = "USUM71703861"
const LINKED_ISRC = "GBAYE0601498"
const SEALED_VIDEO = "kTJczUoc26U"
const LINKED_VIDEO = "Zi_XLOBDo_Y"

const SEALED: LyricsSubmission = {
	videoId: SEALED_VIDEO,
	song: "Harbour Lights at Dawn",
	artist: "Mira Castell",
	album: "Low Tide",
	isrc: SEALED_ISRC,
	duration: 184,
	lyrics: "[00:01.00] The ferry hums along the pier\n[00:06.00] Gulls write circles in the air",
	format: "lrc",
	syncType: "linesync",
	language: "en",
}

const LINKED: LyricsSubmission = {
	videoId: LINKED_VIDEO,
	song: "Paper Lanterns",
	artist: "The Quiet Engines",
	duration: 212,
	lyrics: "[00:02.00] We folded light from paper\n[00:07.00] And sent it down the stream",
	format: "lrc",
	syncType: "linesync",
	language: "en",
}

type Body = {
	success: boolean
	code?: string
	data?: Record<string, unknown> & { videoId?: string; matchedBy?: string }
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

function stubBiniLink(routes: { resolve?: Reply; lookup?: Reply }) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input)
		const reply = url.endsWith("/api/v1/resolve") ? routes.resolve : routes.lookup
		if (!reply) throw new Error(`unexpected BiniLink call: ${url}`)
		return new Response(JSON.stringify(reply.body ?? {}), {
			status: reply.status,
			headers: { "content-type": "application/json", ...reply.headers },
		})
	})
	vi.stubGlobal("fetch", fetchMock)
	return fetchMock
}

const callsTo = (fetchMock: ReturnType<typeof stubBiniLink>, path: string) =>
	fetchMock.mock.calls.filter(([input]) => String(input).endsWith(path))

describeIntegration("GET /lyrics provider id lookups (integration)", () => {
	let db: IntegrationDb

	const get = async (query: string, flag: { enabled?: boolean } = { enabled: true }) => {
		const app = new Elysia().use(lyricsRoutes({ ...db.env, BINILINK_LOOKUP_ENABLED: flag.enabled }))
		const res = await app.handle(new Request(`http://localhost/lyrics?${query}`))
		return { status: res.status, headers: res.headers, body: (await res.json()) as Body }
	}

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		const submitter = await seedUser(db, "provider-id-submitter")
		await submitLyrics(db.env, SEALED, submitter)
		await submitLyrics(db.env, LINKED, submitter)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it("finds a lyric by the ISRC a provider id resolves to", async () => {
		const fetchMock = stubBiniLink({
			resolve: {
				status: 200,
				body: {
					results: [
						{ service: "spotify", id: SPOTIFY_ID, isrc: SEALED_ISRC, youtube: SEALED_VIDEO },
					],
				},
			},
		})

		const { status, body } = await get(`spotify=${SPOTIFY_ID}`)

		expect(status).toBe(200)
		expect(body.data).toMatchObject({
			matchedBy: "isrc",
			videoId: SEALED_VIDEO,
			song: SEALED.song,
			artist: SEALED.artist,
			isrc: SEALED_ISRC,
			lyrics: SEALED.lyrics,
			format: "lrc",
			syncType: "linesync",
			userVote: null,
		})
		expect(body.data).toHaveProperty("id")
		expect(body.data).toHaveProperty("submitter")
		expect(body.data).not.toHaveProperty("variant")
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("falls back to the video BiniLink links to the resolved ISRC", async () => {
		const fetchMock = stubBiniLink({
			resolve: {
				status: 200,
				body: {
					results: [
						{ service: "apple_music", id: APPLE_ID, isrc: LINKED_ISRC, youtube: LINKED_VIDEO },
					],
				},
			},
		})

		const { status, body } = await get(`apple_music=${APPLE_ID}`)

		expect(status).toBe(200)
		expect(body.data?.matchedBy).toBe("linked_video")
		expect(body.data?.videoId).toBe(LINKED_VIDEO)
		expect(body.data).not.toHaveProperty("variant")
		expect(callsTo(fetchMock, "/api/v1/lookup")).toHaveLength(0)
	})

	it("falls back to the linked video for a bare ISRC", async () => {
		const fetchMock = stubBiniLink({
			lookup: { status: 200, body: { results: [{ isrc: LINKED_ISRC, youtube: LINKED_VIDEO }] } },
		})

		const { status, body } = await get(`isrc=${LINKED_ISRC}`)

		expect(status).toBe(200)
		expect(body.data?.matchedBy).toBe("linked_video")
		expect(body.data?.videoId).toBe(LINKED_VIDEO)
		expect(callsTo(fetchMock, "/api/v1/lookup")).toHaveLength(1)
	})

	it("returns 503 with retry-after while the provider id is still resolving", async () => {
		stubBiniLink({
			resolve: {
				status: 200,
				body: { results: [], pending: [{ service: "tidal", id: "77646169" }] },
			},
		})

		const { status, headers, body } = await get("tidal=77646169")

		expect(status).toBe(503)
		expect(body.code).toBe("LOOKUP_PENDING")
		expect(headers.get("retry-after")).toBe(String(config.binilink.pendingRetryAfterSec))
	})

	it("answers from song and artist while the provider id is still resolving", async () => {
		stubBiniLink({
			resolve: {
				status: 200,
				body: { results: [], pending: [{ service: "spotify", id: SPOTIFY_ID }] },
			},
			lookup: { status: 200, body: { results: [] } },
		})

		const { status, body } = await get(
			`spotify=${SPOTIFY_ID}&song=Harbour+Lights+at+Dawn&artist=Mira+Castell`
		)

		expect(status).toBe(200)
		expect(body.data?.matchedBy).toBe("song_artist")
		expect(body.data?.videoId).toBe(SEALED_VIDEO)
	})

	it("rejects a malformed provider id without calling BiniLink", async () => {
		const fetchMock = stubBiniLink({})

		const { status, body } = await get("spotify=abc")

		expect(status).toBe(400)
		expect(body.code).toBe("INVALID_ID")
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("ignores provider ids while the lookup flag is off", async () => {
		const fetchMock = stubBiniLink({})

		for (const enabled of [false, undefined]) {
			const { status } = await get(`spotify=${SPOTIFY_ID}`, { enabled })
			expect(status, String(enabled)).toBe(404)
		}
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("leaves video id lookups unchanged", async () => {
		const fetchMock = stubBiniLink({})

		const { status, body } = await get(`v=${SEALED_VIDEO}&spotify=${SPOTIFY_ID}`)

		expect(status).toBe(200)
		expect(body.data?.videoId).toBe(SEALED_VIDEO)
		expect(body.data).toHaveProperty("variant")
		expect(body.data).not.toHaveProperty("matchedBy")
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("returns 404, never 503, for a bare ISRC while BiniLink is down", async () => {
		// The client pause is module state; a past clock makes it expire before the next suite.
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(Date.now() - (config.binilink.maxPauseSec + 60) * 1000)
		const fetchMock = stubBiniLink({ lookup: { status: 503, headers: { "retry-after": "60" } } })

		const { status } = await get(`isrc=${LINKED_ISRC}`)

		expect(status).toBe(404)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})

const describeLive = process.env.RUN_BINILINK_LIVE === "1" ? describe : describe.skip

describeLive("BiniLink live smoke", () => {
	const ISRC = "GBARL9300135"

	it("resolves an Apple Music id and looks up its ISRC", async (ctx) => {
		const batch = await resolveProviderIds([{ service: "apple_music", id: "1438556832" }])
		if (!batch || batch.results.length === 0) ctx.skip()
		expect(batch?.results[0]).toMatchObject({ service: "apple_music", isrc: ISRC })
		const youtube = batch?.results[0].youtube ?? null
		expect(youtube === null || isVideoId(youtube)).toBe(true)

		await new Promise((resolve) => setTimeout(resolve, 1500))

		const video = await lookupIsrcVideo(ISRC)
		if (!video || video.kind !== "found") ctx.skip()
		const videoId = video?.kind === "found" ? video.videoId : null
		expect(videoId === null || isVideoId(videoId)).toBe(true)
	})
})
