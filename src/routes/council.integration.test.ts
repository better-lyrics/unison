import type { ApplicantView } from "@/db/council-applicants"
import { createBookmark } from "@/db/council-bookmarks"
import type { EditItem, EditThresholds } from "@/db/council-edits"
import { type CouncilEvent, recordCouncilEvent } from "@/db/council-events"
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
		await wipeRevisionData(db)
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
			expect(item).not.toHaveProperty("diffFull")
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

	describe("GET /committee/events", () => {
		type Page = { events: CouncilEvent[]; nextCursor: string | null }

		beforeEach(async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: mira,
				kind: "seal",
				source: "web",
				lyricsId: lyricId,
				refId: 1,
				at: 100,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: ola,
				kind: "reject",
				source: "discord",
				lyricsId: lyricId,
				refId: 2,
				at: 200,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: ola,
				kind: "edit_approve",
				source: "web",
				lyricsId: lyricId,
				refId: 3,
				at: 300,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: admin,
				kind: "member_add",
				source: "web",
				subjectUserId: ola,
				at: 400,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: mira,
				kind: "bookmark",
				source: "web",
				lyricsId: lyricId,
				refId: 5,
				at: 500,
			})
		})

		it("lists the log newest first without bookmarks", async () => {
			const res = await call<Page>("GET", "/committee/events", { token: "mira" })
			expect(res.status).toBe(200)
			expect(res.json.data.events.map((e) => e.kind)).toEqual([
				"member_add",
				"edit_approve",
				"reject",
				"seal",
			])
		})

		it("filters by group, actor and lyric, and includes bookmarks on request", async () => {
			const kinds = async (qs: string) =>
				(
					await call<Page>("GET", `/committee/events?${qs}`, { token: "mira" })
				).json.data.events.map((e) => e.kind)
			expect(await kinds("kind=seals")).toEqual(["seal"])
			expect(await kinds("kind=rejections")).toEqual(["reject"])
			expect(await kinds("kind=edits")).toEqual(["edit_approve"])
			expect(await kinds("kind=membership")).toEqual(["member_add"])
			expect(await kinds(`actor=${OLA}`)).toEqual(["edit_approve", "reject"])
			expect(await kinds(`lyric=${lyricId}&includeBookmarks=1`)).toEqual([
				"bookmark",
				"edit_approve",
				"reject",
				"seal",
			])
		})

		it("pages with a cursor", async () => {
			const first = await call<Page>("GET", "/committee/events?limit=2", { token: "mira" })
			expect(first.json.data.events).toHaveLength(2)
			const second = await call<Page>(
				"GET",
				`/committee/events?limit=2&cursor=${encodeURIComponent(first.json.data.nextCursor ?? "")}`,
				{ token: "mira" }
			)
			expect(second.json.data.events.map((e) => e.kind)).toEqual(["reject", "seal"])
		})

		it("refuses an unknown group and a bad lyric id", async () => {
			expect(
				(await call("GET", "/committee/events?kind=everything", { token: "mira" })).status
			).toBe(400)
			expect(
				(await call("GET", "/committee/events?kind=constructor", { token: "mira" })).status
			).toBe(400)
			expect((await call("GET", "/committee/events?lyric=abc", { token: "mira" })).status).toBe(400)
		})

		it("refuses a malformed cursor", async () => {
			for (const cursor of ["abc", ":", "1:", "1:2:3", "1.5:2", "-1:2", "1e3:2"]) {
				const res = await call("GET", `/committee/events?cursor=${encodeURIComponent(cursor)}`, {
					token: "mira",
				})
				expect([cursor, res.status]).toEqual([cursor, 400])
			}
		})
	})

	describe("GET /committee/overview", () => {
		it("returns the chart, rates and my month", async () => {
			await recordCouncilEvent(db.env.DB, {
				actorId: mira,
				kind: "reject",
				source: "web",
				lyricsId: lyricId,
				refId: 1,
			})
			await recordCouncilEvent(db.env.DB, {
				actorId: ola,
				kind: "seal",
				source: "discord",
				lyricsId: lyricId,
				refId: 2,
			})
			const council = await call<{
				decisionsByDay: { sealed: number; rejected: number }[]
				sealRate: number
			}>("GET", "/committee/overview", { token: "mira" })
			expect(council.status).toBe(200)
			expect(council.json.data.decisionsByDay.at(-1)).toMatchObject({ sealed: 1, rejected: 1 })
			expect(council.json.data.sealRate).toBe(0.5)
			const mine = await call<{ decisionsByDay: { sealed: number }[] }>(
				"GET",
				"/committee/overview?scope=me",
				{
					token: "mira",
				}
			)
			expect(mine.json.data.decisionsByDay.at(-1)?.sealed).toBe(0)
		})
	})

	describe("members", () => {
		it("lists the roster with me marked", async () => {
			const res = await call<{ keyId: string; isYou: boolean; isAdmin: boolean }[]>(
				"GET",
				"/committee/members",
				{
					token: "mira",
				}
			)
			expect(res.status).toBe(200)
			expect(res.json.data.map((m) => [m.keyId, m.isYou, m.isAdmin])).toEqual([
				[MIRA, true, false],
				[OLA, false, false],
				[ADMIN, false, true],
			])
		})

		it("lets an admin add and remove members and logs both", async () => {
			const added = await call("POST", "/committee/members", {
				token: "admin",
				body: { keyId: SUBMITTER },
			})
			expect(added.status).toBe(200)
			const removed = await call("DELETE", `/committee/members/${SUBMITTER}`, { token: "admin" })
			expect(removed.status).toBe(200)
			const { rows } = await db.pool.query(
				"SELECT kind, source, actor_id FROM council_events WHERE kind LIKE 'member%' ORDER BY id"
			)
			expect(rows).toEqual([
				{ kind: "member_add", source: "web", actor_id: admin },
				{ kind: "member_remove", source: "web", actor_id: admin },
			])
		})

		it("refuses to remove an admin or yourself", async () => {
			await db.pool.query("UPDATE committee_members SET is_admin = TRUE WHERE user_id = $1", [ola])
			const peer = await call("DELETE", `/committee/members/${OLA}`, { token: "admin" })
			expect(peer.status).toBe(403)
			expect(peer.json.code).toBe("PROTECTED_MEMBER")
			const self = await call("DELETE", `/committee/members/${ADMIN}`, { token: "admin" })
			expect(self.status).toBe(403)
			expect(self.json.code).toBe("PROTECTED_MEMBER")
			const { rows } = await db.pool.query("SELECT COUNT(*)::int AS n FROM committee_members")
			expect(rows[0].n).toBe(3)
		})

		it("refuses member changes from a non-admin and unknown keys", async () => {
			expect(
				(await call("POST", "/committee/members", { token: "mira", body: { keyId: SUBMITTER } }))
					.json.code
			).toBe("NOT_COUNCIL_ADMIN")
			expect((await call("DELETE", `/committee/members/${OLA}`, { token: "mira" })).status).toBe(
				403
			)
			expect(
				(
					await call("POST", "/committee/members", {
						token: "admin",
						body: { keyId: "0".repeat(64) },
					})
				).status
			).toBe(404)
			expect((await call("POST", "/committee/members", { token: "admin", body: {} })).status).toBe(
				400
			)
		})
	})

	describe("applicants", () => {
		const APPLICANT = "96".repeat(32)
		let session: number

		beforeEach(async () => {
			await db.pool.query("DELETE FROM exam_session WHERE key_id = $1", [APPLICANT])
			await db.pool.query("DELETE FROM users WHERE key_id = $1", [APPLICANT])
			const { rows } = await db.pool.query<{ id: string }>(
				`INSERT INTO exam_session (key_id, discord_id, seed, expires_at, state, score, max_score, cutoff, submitted_at)
				 VALUES ($1, 'd-app', 1, 2000000000, 'pending_review', 94, 100, 85, 1790000000) RETURNING id`,
				[APPLICANT]
			)
			session = Number(rows[0].id)
		})

		const applicants = async (token: string, qs = "") =>
			(await call<ApplicantView[]>("GET", `/committee/applicants${qs}`, { token })).json.data

		it("lists applicants with opinions and my stance", async () => {
			await call("PUT", `/committee/applicants/${session}/opinion`, {
				token: "ola",
				body: { stance: "object", note: "Sealed too eagerly in two scenarios." },
			})
			await call("PUT", `/committee/applicants/${session}/opinion`, {
				token: "mira",
				body: { stance: "support" },
			})
			const [a] = await applicants("mira")
			expect(a).toMatchObject({
				applicantId: session,
				score: 94,
				cutoff: 85,
				state: "pending_review",
			})
			expect(a).not.toHaveProperty("decidedByDiscordId")
			expect(a.opinions.mine).toBe("support")
			expect(a.opinions.support.map((p) => p.keyId)).toEqual([MIRA])
			expect(a.opinions.object.map((p) => p.keyId)).toEqual([OLA])
			expect(a.opinions.notes).toEqual([
				expect.objectContaining({ stance: "object", note: "Sealed too eagerly in two scenarios." }),
			])
		})

		it("clears an opinion and refuses a bad stance or unknown applicant", async () => {
			await call("PUT", `/committee/applicants/${session}/opinion`, {
				token: "mira",
				body: { stance: "support" },
			})
			await call("PUT", `/committee/applicants/${session}/opinion`, {
				token: "mira",
				body: { stance: null },
			})
			expect((await applicants("mira"))[0].opinions.mine).toBeNull()
			const bad = await call("PUT", `/committee/applicants/${session}/opinion`, {
				token: "mira",
				body: { stance: "maybe" },
			})
			expect(bad.json.code).toBe("INVALID_OPINION")
			const missing = await call("PUT", "/committee/applicants/987654321/opinion", {
				token: "mira",
				body: { stance: "support" },
			})
			expect(missing.status).toBe(404)
		})

		it("lets an admin approve, which adds the applicant to the council", async () => {
			const res = await call("POST", `/committee/applicants/${session}/decision`, {
				token: "admin",
				body: { decision: "approve" },
			})
			expect(res.status).toBe(200)
			const { rows } = await db.pool.query(
				"SELECT 1 FROM committee_members c JOIN users u ON u.id = c.user_id WHERE u.key_id = $1",
				[APPLICANT]
			)
			expect(rows).toHaveLength(1)
			expect(await applicants("mira")).toEqual([])
			await db.pool.query(
				"DELETE FROM committee_members WHERE user_id = (SELECT id FROM users WHERE key_id = $1)",
				[APPLICANT]
			)
		})

		it("regression: leaves the applicant pending when adding to the council fails", async () => {
			await db.pool.query(
				"CREATE FUNCTION refuse_member() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql"
			)
			await db.pool.query(
				"CREATE TRIGGER refuse_member BEFORE INSERT ON committee_members FOR EACH ROW EXECUTE FUNCTION refuse_member()"
			)
			try {
				const res = await new Elysia().use(councilRoutes(db.env)).handle(
					new Request(`http://localhost/committee/applicants/${session}/decision`, {
						method: "POST",
						headers: { "content-type": "application/json", authorization: "Bearer admin" },
						body: JSON.stringify({ decision: "approve" }),
					})
				)
				expect(res.status).toBe(500)
			} finally {
				await db.pool.query("DROP TRIGGER refuse_member ON committee_members")
				await db.pool.query("DROP FUNCTION refuse_member()")
			}
			const { rows } = await db.pool.query("SELECT state FROM exam_session WHERE id = $1", [
				session,
			])
			expect(rows[0].state).toBe("pending_review")
			const events = await db.pool.query(
				"SELECT 1 FROM council_events WHERE kind = 'applicant_approve' AND ref_id = $1",
				[session]
			)
			expect(events.rows).toEqual([])
		})

		it("refuses a decision from a non-admin, a bad decision and a decided applicant", async () => {
			const member = await call("POST", `/committee/applicants/${session}/decision`, {
				token: "mira",
				body: { decision: "approve" },
			})
			expect(member.status).toBe(403)
			expect(
				(
					await call("POST", `/committee/applicants/${session}/decision`, {
						token: "admin",
						body: { decision: "maybe" },
					})
				).status
			).toBe(400)
			await call("POST", `/committee/applicants/${session}/decision`, {
				token: "admin",
				body: { decision: "reject" },
			})
			const again = await call("POST", `/committee/applicants/${session}/decision`, {
				token: "admin",
				body: { decision: "approve" },
			})
			expect(again.status).toBe(404)
		})

		it("shows near misses only on request", async () => {
			await db.pool.query("UPDATE exam_session SET state = 'failed' WHERE id = $1", [session])
			expect(await applicants("mira")).toEqual([])
			const [a] = await applicants("mira", "?includeBelowCutoff=1")
			expect(a.state).toBe("failed")
			expect(a.retakeAt).toBeGreaterThan(1790000000)
		})
	})
})
