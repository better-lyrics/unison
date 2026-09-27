import { createBookmark } from "@/db/council-bookmarks"
import type { EditItem, EditThresholds } from "@/db/council-edits"
import type { QueueItem } from "@/db/council-queue"
import { saveRevision } from "@/services/lyric-revisions"
import {
	BOT_SECRET,
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedCouncilMember,
	seedLyric,
	seedSession,
	seedUser,
	wipeRevisionData,
} from "@/test/integration-harness"
import { readRevisionFixture, swapWords } from "@/test/lyric-fixtures"
import type { Env } from "@/types"
import { Elysia } from "elysia"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { committeeBotRoutes } from "./committee"
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

	describe("GET /committee/edits", () => {
		async function pendingEdit(): Promise<number> {
			await db.pool.query("UPDATE lyrics SET committee_approved_at = 1 WHERE id = $1", [lyricId])
			await db.pool.query("UPDATE users SET nickname = 'Sigma' WHERE id = $1", [submitter])
			const saved = await saveRevision(db.env, lyricId, submitter, {
				lyrics: swapWords(LRC, 2),
				format: "lrc",
				language: "en",
			})
			if (!saved.ok) throw new Error("setup")
			return saved.revision.id
		}

		it("lists pending edits with the author, bookmark and thresholds", async () => {
			const revisionId = await pendingEdit()
			await createBookmark(db.env, ola, "edit", revisionId, "web")
			const res = await call<{ items: EditItem[]; thresholds: EditThresholds }>(
				"GET",
				"/committee/edits",
				{ token: "mira" }
			)
			expect(res.status).toBe(200)
			expect(res.json.data.thresholds).toEqual({ textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.8 })
			const [item] = res.json.data.items
			expect(item).toMatchObject({
				revisionId,
				lyricsId: lyricId,
				pendingReason: "sealed",
				author: { keyId: SUBMITTER, displayName: "Sigma" },
				bookmark: { holder: { keyId: OLA } },
			})
			expect(item).not.toHaveProperty("authorKeyId")
			expect(item.diffFull).toContain("--- rev 1")
		})

		it("returns no items when nothing is pending", async () => {
			const res = await call<{ items: EditItem[] }>("GET", "/committee/edits", { token: "mira" })
			expect(res.json.data.items).toEqual([])
		})
	})

	describe("bookmarks", () => {
		interface Bookmark {
			id: number
			itemType: string
			itemId: number
			holder: { keyId: string; tier: string | null }
			expiresAt: number
		}

		it("bookmarks and releases a seal candidate", async () => {
			const created = await call<Bookmark>("POST", "/committee/bookmarks", {
				token: "mira",
				body: { itemType: "seal", itemId: lyricId },
			})
			expect(created.status).toBe(200)
			expect(created.json.data).toMatchObject({
				itemType: "seal",
				itemId: lyricId,
				holder: { keyId: MIRA },
			})
			const released = await call("DELETE", `/committee/bookmarks/${created.json.data.id}`, {
				token: "mira",
			})
			expect(released.status).toBe(200)
		})

		it("reports the holder when someone else has the item", async () => {
			await call("POST", "/committee/bookmarks", {
				token: "mira",
				body: { itemType: "seal", itemId: lyricId },
			})
			const res = await call("POST", "/committee/bookmarks", {
				token: "ola",
				body: { itemType: "seal", itemId: lyricId },
			})
			expect(res.status).toBe(409)
			expect(res.json.code).toBe("BOOKMARK_HELD")
		})

		it("maps the cap, a missing item, a bad body and someone else's release", async () => {
			for (let i = 0; i < 5; i++) {
				const id = await seedLyric(db, submitter, {
					lyrics: LRC,
					format: "lrc",
					videoId: `capcapcap0${i}`,
				})
				await createBookmark(db.env, mira, "seal", id, "web")
			}
			const capped = await call("POST", "/committee/bookmarks", {
				token: "mira",
				body: { itemType: "seal", itemId: lyricId },
			})
			expect(capped.status).toBe(409)
			expect(capped.json.code).toBe("BOOKMARK_CAP")
			const missing = await call("POST", "/committee/bookmarks", {
				token: "ola",
				body: { itemType: "seal", itemId: 99999999 },
			})
			expect(missing.status).toBe(404)
			for (const body of [
				{ itemType: "song", itemId: lyricId },
				{ itemType: "seal", itemId: -1 },
				{},
			]) {
				expect((await call("POST", "/committee/bookmarks", { token: "ola", body })).status).toBe(
					400
				)
			}
			const held = await call<Bookmark>("POST", "/committee/bookmarks", {
				token: "ola",
				body: { itemType: "seal", itemId: lyricId },
			})
			const forbidden = await call("DELETE", `/committee/bookmarks/${held.json.data.id}`, {
				token: "mira",
			})
			expect(forbidden.status).toBe(403)
			expect(
				(await call("DELETE", "/committee/bookmarks/12345678", { token: "mira" })).status
			).toBe(404)
		})

		it("throttles bookmark writes", async () => {
			const limited = {
				...db.env,
				RATE_LIMITER: {
					async limit() {
						return { success: false }
					},
				},
			} as unknown as Env
			const res = await call("POST", "/committee/bookmarks", {
				token: "mira",
				body: { itemType: "seal", itemId: lyricId },
				env: limited,
			})
			expect(res.status).toBe(429)
		})
	})

	describe("GET /committee/bookmarks/bot", () => {
		const botCall = async (token: string) => {
			const res = await committeeBotRoutes(db.env).handle(
				new Request("http://localhost/committee/bookmarks/bot", {
					headers: { authorization: `Bearer ${token}` },
				})
			)
			return { status: res.status, json: (await res.json()) as Envelope<{ bookmarks: unknown[] }> }
		}

		it("lists active bookmarks with the holder's Discord id", async () => {
			await db.pool.query(
				"INSERT INTO discord_links (discord_id, key_id, discord_username) VALUES ('d-mira', $1, 'mira')",
				[MIRA]
			)
			await createBookmark(db.env, mira, "seal", lyricId, "web")
			const res = await botCall(BOT_SECRET)
			expect(res.status).toBe(200)
			expect(res.json.data.bookmarks).toEqual([
				expect.objectContaining({
					itemType: "seal",
					itemId: lyricId,
					lyricsId: lyricId,
					holder: expect.objectContaining({ keyId: MIRA, discordId: "d-mira" }),
				}),
			])
			await db.pool.query("DELETE FROM discord_links WHERE key_id = $1", [MIRA])
		})

		it("refuses a wrong bot secret", async () => {
			expect((await botCall("nope")).status).toBe(401)
		})
	})
})
