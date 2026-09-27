import type { QueueItem } from "@/db/council-queue"
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
import type { Env } from "@/types"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { councilRoutes } from "./council"

const MIRA = "91".repeat(32)
const OLA = "92".repeat(32)
const ADMIN = "93".repeat(32)
const STRANGER = "94".repeat(32)
const SUBMITTER = "95".repeat(32)
const LRC = readRevisionFixture("amazing-grace.lrc")

interface Envelope<T> {
	success: boolean
	data: T
	code?: string
	hint?: string
	nextCursor?: string | null
}

describeIntegration("council dashboard routes (integration)", () => {
	let db: IntegrationDb
	let mira: number
	let ola: number
	let admin: number
	let submitter: number
	let lyricId: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.end()
	})

	beforeEach(async () => {
		await wipeRevisionData(db)
		mira = await seedCouncilMember(db, MIRA)
		ola = await seedCouncilMember(db, OLA)
		admin = await seedCouncilMember(db, ADMIN)
		await db.pool.query("UPDATE committee_members SET is_admin = TRUE WHERE user_id = $1", [admin])
		await seedUser(db, STRANGER)
		submitter = await seedUser(db, SUBMITTER)
		lyricId = await seedLyric(db, submitter, { lyrics: LRC, format: "lrc", videoId: "dQw4w9WgXcQ" })
		await db.pool.query(
			"UPDATE lyrics SET effective_score = 0.9, upvotes = 19, downvotes = 1, vote_count = 20 WHERE id = $1",
			[lyricId]
		)
		seedSession(db, "mira", MIRA)
		seedSession(db, "ola", OLA)
		seedSession(db, "admin", ADMIN)
		seedSession(db, "stranger", STRANGER)
	})

	const call = async <T = unknown>(
		method: string,
		path: string,
		opts: { token?: string; body?: unknown; env?: Env } = {}
	): Promise<{ status: number; json: Envelope<T> }> => {
		const headers: Record<string, string> = { "content-type": "application/json" }
		if (opts.token) headers.authorization = `Bearer ${opts.token}`
		const res = await new Elysia().use(councilRoutes(opts.env ?? db.env)).handle(
			new Request(`http://localhost${path}`, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			})
		)
		return { status: res.status, json: (await res.json()) as Envelope<T> }
	}

	describe("guard", () => {
		it("refuses a signed-out request and a non-member", async () => {
			expect((await call("GET", "/committee/queue")).status).toBe(401)
			const stranger = await call("GET", "/committee/queue", { token: "stranger" })
			expect(stranger.status).toBe(403)
			expect(stranger.json.code).toBe("NOT_COMMITTEE")
		})
	})

	describe("GET /committee/queue", () => {
		it("lists the live queue for a member", async () => {
			const res = await call<QueueItem[]>("GET", "/committee/queue", { token: "mira" })
			expect(res.status).toBe(200)
			expect(res.json.data.map((i) => i.id)).toEqual([lyricId])
			expect(res.json.data[0].submitter?.keyId).toBe(SUBMITTER)
		})
	})
})
