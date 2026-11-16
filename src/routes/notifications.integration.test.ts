import {
	type IntegrationDb,
	describeIntegration,
	openIntegrationDb,
	seedSession,
	seedUser,
} from "@/test/integration-harness"
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest"
import { notificationRoutes } from "./notifications"

const A_KEY = "1".repeat(64)
const B_KEY = "2".repeat(64)
const A_TOKEN = "notifications-token-a"

describeIntegration("notification routes (integration)", () => {
	let db: IntegrationDb
	let a: number
	let b: number

	beforeAll(async () => {
		db = await openIntegrationDb()
	})

	afterAll(async () => {
		await db.pool.query("DELETE FROM users WHERE key_id = ANY($1)", [[A_KEY, B_KEY]])
		await db.pool.end()
	})

	beforeEach(async () => {
		await db.pool.query("DELETE FROM users WHERE key_id = ANY($1)", [[A_KEY, B_KEY]])
		db.cache.store.clear()
		a = await seedUser(db, A_KEY)
		b = await seedUser(db, B_KEY)
		seedSession(db, A_TOKEN, A_KEY)
	})

	const call = (
		method: string,
		path: string,
		headers: Record<string, string> = {},
		body?: unknown
	) =>
		notificationRoutes(db.env).handle(
			new Request(`http://localhost${path}`, {
				method,
				headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		)

	it("refuses every web route without a session", async () => {
		const routes: [string, string, unknown?][] = [
			["GET", "/notifications"],
			["GET", "/notifications/unread"],
			["POST", "/notifications/seen"],
			["GET", "/notifications/settings"],
			["PUT", "/notifications/settings", { discordDm: true }],
		]
		for (const [method, path, body] of routes) {
			expect((await call(method, path, {}, body)).status, `${method} ${path}`).toBe(401)
		}
	})

	it("lists only the signed-in user's notifications", async () => {
		await db.pool.query(
			`INSERT INTO notifications (user_id, kind, ref_id, data)
			 VALUES ($1, 'suggestion_approved', 101, '{"revNo": 2}'), ($2, 'suggestion_approved', 202, '{}')`,
			[a, b]
		)
		const res = await call("GET", "/notifications", { authorization: `Bearer ${A_TOKEN}` })
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			data: { unread: number; items: { kind: string; group: string; data: unknown }[] }
		}
		expect(json.data.unread).toBe(1)
		expect(json.data.items).toEqual([
			expect.objectContaining({
				kind: "suggestion_approved",
				group: "suggestions",
				actor: null,
				song: null,
				data: { revNo: 2, revisionId: 101 },
			}),
		])
	})
})
