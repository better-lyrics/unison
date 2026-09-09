import { type SealCandidate, getSealCandidates, rejectLyric, undoRejection } from "@/db/rejections"
import { getUserByKeyId } from "@/db/users"
import type { Env } from "@/types"
import { isAuthorizedBot } from "@/utils/bot-auth"
import { compress } from "@/utils/compression"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { reviewQueueBotRoutes } from "./review-queue"

vi.mock("@/utils/bot-auth", () => ({ isAuthorizedBot: vi.fn() }))
vi.mock("@/db/users", () => ({ getUserByKeyId: vi.fn() }))
vi.mock("@/db/rejections", () => ({
	getSealCandidates: vi.fn(),
	rejectLyric: vi.fn(),
	undoRejection: vi.fn(),
}))

const KEY = "k".repeat(64)
const reviewer = { id: 7, key_id: KEY } as unknown as Awaited<ReturnType<typeof getUserByKeyId>>
const app = () => reviewQueueBotRoutes({} as Env)

function candidate(over: Partial<SealCandidate> = {}): SealCandidate {
	return {
		id: 1,
		video_id: "vid123",
		song: "Song",
		artist: "Artist",
		format: "lrc",
		score: 5,
		vote_count: 3,
		lyrics: "gz",
		submitter_key_id: "a".repeat(64),
		submitter_nickname: "Nick",
		...over,
	}
}

function getReq(qs = "") {
	return new Request(`http://localhost/lyrics/queue/bot${qs}`, {
		method: "GET",
		headers: { authorization: "Bearer secret" },
	})
}

function bodyReq(method: "POST" | "DELETE", id: string, body: unknown) {
	return new Request(`http://localhost/lyrics/${id}/reject/bot`, {
		method,
		headers: { authorization: "Bearer secret", "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}

beforeEach(() => vi.clearAllMocks())

describe("GET /lyrics/queue/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(getReq())
		expect(res.status).toBe(401)
		expect(((await res.json()) as { code: string }).code).toBe("AUTH_REQUIRED")
	})

	it("maps candidates into the response shape with a submitter", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getSealCandidates).mockResolvedValue([candidate()])
		const res = await app().handle(getReq())
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			success: true,
			data: [
				{
					id: 1,
					videoId: "vid123",
					song: "Song",
					artist: "Artist",
					format: "lrc",
					score: 5,
					voteCount: 3,
					submitter: { displayName: "Nick" },
				},
			],
		})
	})

	it("returns a null submitter when there is no submitter key", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getSealCandidates).mockResolvedValue([
			candidate({ submitter_key_id: null, submitter_nickname: null }),
		])
		const res = await app().handle(getReq())
		const body = (await res.json()) as { data: { submitter: unknown }[] }
		expect(body.data[0].submitter).toBeNull()
	})

	it("attaches ttmlSignals only for ttml items", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		const ttml =
			'<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="0:00" end="0:02">hello world</p></div></body></tt>'
		vi.mocked(getSealCandidates).mockResolvedValue([
			candidate({ id: 1, format: "ttml", lyrics: await compress(ttml) }),
			candidate({ id: 2, format: "lrc" }),
		])
		const res = await app().handle(getReq())
		const body = (await res.json()) as {
			data: { id: number; ttmlSignals?: string[] }[]
		}
		expect(body.data[0].ttmlSignals).toContain("line-synced")
		expect(body.data[0].ttmlSignals).toContain("not-sentence-case")
		expect(body.data[1]).not.toHaveProperty("ttmlSignals")
	})

	it("returns an empty data array when nothing is eligible", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getSealCandidates).mockResolvedValue([])
		const res = await app().handle(getReq())
		expect(await res.json()).toEqual({ success: true, data: [] })
	})

	it("defaults to limit 10 and top-rated sort", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getSealCandidates).mockResolvedValue([])
		await app().handle(getReq())
		expect(vi.mocked(getSealCandidates)).toHaveBeenCalledWith(expect.anything(), {
			limit: 10,
			sort: "top-rated",
		})
	})

	it("caps the limit at 25 and honors most-voted sort", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getSealCandidates).mockResolvedValue([])
		await app().handle(getReq("?limit=100&sort=most-voted"))
		expect(vi.mocked(getSealCandidates)).toHaveBeenCalledWith(expect.anything(), {
			limit: 25,
			sort: "most-voted",
		})
	})
})

describe("POST /lyrics/:id/reject/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(bodyReq("POST", "1", { keyId: KEY }))
		expect(res.status).toBe(401)
	})

	it("returns 400 for a non-numeric id", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		const res = await app().handle(bodyReq("POST", "abc", { keyId: KEY }))
		expect(res.status).toBe(400)
		expect(((await res.json()) as { code: string }).code).toBe("INVALID_ID")
	})

	it("returns 404 for an unresolved keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(null)
		const res = await app().handle(bodyReq("POST", "1", { keyId: KEY }))
		expect(res.status).toBe(404)
		expect(vi.mocked(rejectLyric)).not.toHaveBeenCalled()
	})

	it("returns 403 when the reviewer is not on the council", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(rejectLyric).mockResolvedValue({ ok: false, reason: "not_committee" })
		const res = await app().handle(bodyReq("POST", "1", { keyId: KEY }))
		expect(res.status).toBe(403)
		expect(((await res.json()) as { code: string }).code).toBe("NOT_COMMITTEE")
	})

	it("returns 404 when the lyric is missing", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(rejectLyric).mockResolvedValue({ ok: false, reason: "lyric_not_found" })
		const res = await app().handle(bodyReq("POST", "1", { keyId: KEY }))
		expect(res.status).toBe(404)
	})

	it("returns 409 when a rejection is already active", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(rejectLyric).mockResolvedValue({ ok: false, reason: "already_rejected" })
		const res = await app().handle(bodyReq("POST", "1", { keyId: KEY }))
		expect(res.status).toBe(409)
		expect(((await res.json()) as { code: string }).code).toBe("REJECT_ALREADY_ACTIVE")
	})

	it("records the rejection and forwards the note", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(rejectLyric).mockResolvedValue({ ok: true })
		const res = await app().handle(bodyReq("POST", "42", { keyId: KEY, note: "bad sync" }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
		expect(vi.mocked(rejectLyric)).toHaveBeenCalledWith(expect.anything(), 42, 7, "bad sync")
	})
})

describe("DELETE /lyrics/:id/reject/bot", () => {
	it("rejects a bad bot secret with 401", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(false)
		const res = await app().handle(bodyReq("DELETE", "1", { keyId: KEY }))
		expect(res.status).toBe(401)
	})

	it("returns 404 for an unresolved keyId", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(null)
		const res = await app().handle(bodyReq("DELETE", "1", { keyId: KEY }))
		expect(res.status).toBe(404)
		expect(vi.mocked(undoRejection)).not.toHaveBeenCalled()
	})

	it("returns 403 when the actor is not on the council", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(undoRejection).mockResolvedValue({ ok: false, reason: "not_committee" })
		const res = await app().handle(bodyReq("DELETE", "1", { keyId: KEY }))
		expect(res.status).toBe(403)
	})

	it("returns 404 when there is no active rejection", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(undoRejection).mockResolvedValue({ ok: false, reason: "not_found" })
		const res = await app().handle(bodyReq("DELETE", "1", { keyId: KEY }))
		expect(res.status).toBe(404)
	})

	it("undoes the rejection", async () => {
		vi.mocked(isAuthorizedBot).mockReturnValue(true)
		vi.mocked(getUserByKeyId).mockResolvedValue(reviewer)
		vi.mocked(undoRejection).mockResolvedValue({ ok: true })
		const res = await app().handle(bodyReq("DELETE", "9", { keyId: KEY }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
		expect(vi.mocked(undoRejection)).toHaveBeenCalledWith(expect.anything(), 9, 7)
	})
})
