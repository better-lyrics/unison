import type { MetadataItem } from "@/db/council-metadata"
import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture } from "@/test/lyric-fixtures"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { councilRoutes } from "./council"

const MIRA = "a1".repeat(32)
const OLA = "a2".repeat(32)
const KAI = "a3".repeat(32)
const STRANGER = "a4".repeat(32)
const SUBMITTER = "a5".repeat(32)
const VIDEO = "dQw4w9WgXcQ"
const LRC = readRevisionFixture("amazing-grace.lrc")

const PROPOSAL = {
	videoId: VIDEO,
	song: "Amazing Grace (My Chains Are Gone)",
	artist: "Chris Tomlin",
	album: "See the Morning",
}

interface Envelope<T> {
	success: boolean
	data: T
	code?: string
	hint?: string
}

describeIntegration("council metadata routes (integration)", () => {
	let db: IntegrationDb

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await wipeRevisionData(db)
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		await seedCouncilMember(db, MIRA)
		await seedCouncilMember(db, OLA)
		await seedCouncilMember(db, KAI)
		await seedUser(db, STRANGER)
		const submitter = await seedUser(db, SUBMITTER)
		await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: VIDEO })
		seedSession(db, "mira", MIRA)
		seedSession(db, "ola", OLA)
		seedSession(db, "kai", KAI)
		seedSession(db, "stranger", STRANGER)
	})

	const call = async <T = unknown>(
		method: string,
		path: string,
		opts: { token?: string; body?: unknown } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (opts.token) headers.authorization = `Bearer ${opts.token}`
		const res = await new Elysia().use(councilRoutes(db.env)).handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			})
		)
		return { status: res.status, json: (await res.json()) as Envelope<T> }
	}

	const propose = async (token = "mira", body: unknown = PROPOSAL) => {
		const res = await call<{ id: number }>("POST", "/committee/metadata", { token, body })
		expect(res.status).toBe(200)
		return res.json.data.id
	}

	const vote = (id: number, token: string, body: unknown) =>
		call<{ status: string }>("POST", `/committee/metadata/${id}/vote`, { token, body })

	describe("GET /committee/metadata", () => {
		it("lists open proposals with council people and the quorum", async () => {
			const id = await propose()
			await vote(id, "ola", { approve: true })
			const res = await call<{ items: MetadataItem[]; needed: number }>(
				"GET",
				"/committee/metadata",
				{
					token: "kai",
				}
			)
			expect(res.status).toBe(200)
			expect(res.json.data.needed).toBe(3)
			const [item] = res.json.data.items
			expect(item).toMatchObject({
				id,
				videoId: VIDEO,
				song: "Amazing Grace",
				artist: "Traditional",
				proposed: { song: PROPOSAL.song, artist: PROPOSAL.artist, album: PROPOSAL.album },
				before: { song: "Amazing Grace", artist: "Traditional", album: null },
			})
			expect(item.proposer?.keyId).toBe(MIRA)
			expect(item.proposer).toHaveProperty("tier")
			expect(item.approvers.map((p) => p.keyId)).toEqual([MIRA, OLA])
		})

		it("returns an empty list when nothing is open", async () => {
			const res = await call<{ items: MetadataItem[] }>("GET", "/committee/metadata", {
				token: "mira",
			})
			expect(res.json.data.items).toEqual([])
		})

		it("refuses a user who is not on the council", async () => {
			const res = await call("GET", "/committee/metadata", { token: "stranger" })
			expect(res.status).toBe(403)
			expect(res.json.code).toBe("NOT_COMMITTEE")
		})
	})

	describe("POST /committee/metadata", () => {
		it("refuses a second open proposal for the same song", async () => {
			await propose()
			const res = await call("POST", "/committee/metadata", {
				token: "ola",
				body: { ...PROPOSAL, artist: "Someone" },
			})
			expect(res.status).toBe(409)
			expect(res.json.code).toBe("PROPOSAL_OPEN")
		})

		it("refuses values that change nothing", async () => {
			const res = await call("POST", "/committee/metadata", {
				token: "mira",
				body: { videoId: VIDEO, song: "Amazing Grace", artist: "Traditional" },
			})
			expect(res.status).toBe(409)
			expect(res.json.code).toBe("NO_CHANGES")
			expect(res.json.hint).toMatch(/title, artist and album/)
		})

		it("refuses a video with no lyric", async () => {
			const res = await call("POST", "/committee/metadata", {
				token: "mira",
				body: { ...PROPOSAL, videoId: "HsBfV2A5dUY" },
			})
			expect(res.status).toBe(404)
		})

		it.each([
			["a missing artist", { videoId: VIDEO, song: "S" }],
			["a bad video id", { ...PROPOSAL, videoId: "nope" }],
			["an empty body", {}],
		])("refuses %s", async (_, body) => {
			const res = await call("POST", "/committee/metadata", { token: "mira", body })
			expect(res.status).toBe(400)
			expect(res.json.code).toBe("INVALID_PAYLOAD")
		})

		it("refuses a user who is not on the council", async () => {
			const res = await call("POST", "/committee/metadata", { token: "stranger", body: PROPOSAL })
			expect(res.status).toBe(403)
		})
	})

	describe("POST /committee/metadata/:id/vote", () => {
		it("passes at the quorum, rewrites the song and evicts its caches", async () => {
			db.cache.store.set(`v:${VIDEO}`, "{}")
			db.cache.store.set("feed:global:20", "[]")
			db.cache.store.set("feed:sealed:recent:20", "[]")
			const id = await propose()
			expect((await vote(id, "ola", { approve: true })).json.data.status).toBe("open")
			expect(db.cache.store.has(`v:${VIDEO}`)).toBe(true)

			const res = await vote(id, "kai", { approve: true })
			expect(res.status).toBe(200)
			expect(res.json.data.status).toBe("passed")
			const row = await db.pool.query(
				"SELECT song, artist, album FROM lyrics WHERE video_id = $1",
				[VIDEO]
			)
			expect(row.rows[0]).toEqual({
				song: PROPOSAL.song,
				artist: PROPOSAL.artist,
				album: PROPOSAL.album,
			})
			expect(db.cache.store.has(`v:${VIDEO}`)).toBe(false)
			expect([...db.cache.store.keys()].filter((k) => k.startsWith("feed:"))).toEqual([])
		})

		it("closes on a reject and refuses later votes", async () => {
			const id = await propose()
			const rejected = await vote(id, "ola", { approve: false, note: "wrong artist" })
			expect(rejected.json.data.status).toBe("rejected")
			const late = await vote(id, "kai", { approve: true })
			expect(late.status).toBe(409)
			expect(late.json.code).toBe("ALREADY_DECIDED")
			expect(late.json.hint).toMatch(/proposal/)
			const note = await db.pool.query(
				"SELECT note FROM council_events WHERE kind = 'metadata_reject' AND ref_id = $1",
				[id]
			)
			expect(note.rows).toEqual([{ note: "wrong artist" }])
		})

		it.each([
			["a non-boolean approve", { approve: "yes" }],
			["a missing approve", {}],
			["a note over the limit", { approve: false, note: "x".repeat(5000) }],
		])("refuses %s", async (_, body) => {
			const id = await propose()
			const res = await vote(id, "ola", body)
			expect(res.status).toBe(400)
		})

		it("refuses an id that is not a number", async () => {
			const res = await vote(Number.NaN, "ola", { approve: true })
			expect(res.status).toBe(400)
			expect(res.json.code).toBe("INVALID_ID")
		})

		it("returns 404 for an unknown proposal", async () => {
			const res = await vote(999_999, "ola", { approve: true })
			expect(res.status).toBe(404)
		})

		it("refuses a user who is not on the council", async () => {
			const id = await propose()
			const res = await vote(id, "stranger", { approve: true })
			expect(res.status).toBe(403)
		})
	})
})
