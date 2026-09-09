import { addCommittee, listCommitteeKeyIds, removeCommittee } from "@/db/committee"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { committeeBotRoutes } from "./committee"

vi.mock("@/utils/bot-auth", () => ({ isAuthorizedBot: vi.fn() }))
vi.mock("@/db/users", () => ({ getUserByKeyId: vi.fn() }))
vi.mock("@/db/committee", () => ({
	addCommittee: vi.fn(),
	removeCommittee: vi.fn(),
	listCommitteeKeyIds: vi.fn(),
}))

const KEY = "k".repeat(64)
const member = { id: 7, key_id: KEY } as unknown as Awaited<ReturnType<typeof getUserByKeyId>>
const app = () => committeeBotRoutes({} as Env)

function bodyReq(method: "POST" | "DELETE", body: unknown) {
	return new Request("http://localhost/committee/bot", {
		method,
		headers: { authorization: "Bearer secret", "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}

function getReq() {
	return new Request("http://localhost/committee/bot", {
		method: "GET",
		headers: { authorization: "Bearer secret" },
	})
}

beforeEach(() => vi.clearAllMocks())

describe("POST /committee/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(bodyReq("POST", { keyId: KEY }))
		expect(res.status).toBe(401)
		expect(((await res.json()) as { code: string }).code).toBe("AUTH_REQUIRED")
	})

	it("returns 404 for an unresolved keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(null)
		const res = await app().handle(bodyReq("POST", { keyId: KEY }))
		expect(res.status).toBe(404)
		expect(((await res.json()) as { code: string }).code).toBe("NOT_FOUND")
		expect(vi.mocked(addCommittee)).not.toHaveBeenCalled()
	})

	it("adds the member and echoes the keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(member)
		const res = await app().handle(bodyReq("POST", { keyId: KEY }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { keyId: KEY } })
		expect(vi.mocked(addCommittee)).toHaveBeenCalledWith(expect.anything(), 7, "bot")
	})
})

describe("DELETE /committee/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(bodyReq("DELETE", { keyId: KEY }))
		expect(res.status).toBe(401)
	})

	it("returns 404 for an unresolved keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(null)
		const res = await app().handle(bodyReq("DELETE", { keyId: KEY }))
		expect(res.status).toBe(404)
		expect(vi.mocked(removeCommittee)).not.toHaveBeenCalled()
	})

	it("removes the member", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(member)
		const res = await app().handle(bodyReq("DELETE", { keyId: KEY }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
		expect(vi.mocked(removeCommittee)).toHaveBeenCalledWith(expect.anything(), 7)
	})
})

describe("GET /committee/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(getReq())
		expect(res.status).toBe(401)
	})

	it("returns the committee keyIds", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(listCommitteeKeyIds).mockResolvedValue([KEY, "a".repeat(64)])
		const res = await app().handle(getReq())
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, data: { keyIds: [KEY, "a".repeat(64)] } })
	})
})
