import { afterEach, describe, expect, it, vi } from "vitest"
import { autosaveAnswer, fetchExamSession, submitExam } from "./examApi"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => vi.restoreAllMocks())

describe("fetchExamSession", () => {
  it("returns the session data on success", async () => {
    const data = {
      candidate: { displayName: "Tester" },
      questions: [],
      timeLimitSec: 1500,
      expiresAt: 1,
      savedAnswers: {},
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data })))
    expect(await fetchExamSession("tok")).toEqual(data)
  })

  it("puts the token in the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: {} }))
    vi.stubGlobal("fetch", fetchMock)
    await fetchExamSession("a b")
    expect(fetchMock).toHaveBeenCalledWith("/exam/session?t=a%20b")
  })

  it("throws the server error code on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(410, { success: false, code: "EXAM_TOKEN_EXPIRED" })))
    await expect(fetchExamSession("tok")).rejects.toThrow("EXAM_TOKEN_EXPIRED")
  })

  it("falls back to REQUEST_FAILED when the error body is unreadable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    await expect(fetchExamSession("tok")).rejects.toThrow("REQUEST_FAILED")
  })
})

describe("autosaveAnswer", () => {
  it("posts the token, question id, and answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }))
    vi.stubGlobal("fetch", fetchMock)
    await autosaveAnswer("tok", 3, { verdict: "no" })
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe("/exam/answer")
    expect(JSON.parse(init.body)).toEqual({ t: "tok", questionId: 3, answer: { verdict: "no" } })
  })

  it("throws the error code on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "EXAM_ALREADY_SUBMITTED" })))
    await expect(autosaveAnswer("tok", 1, {})).rejects.toThrow("EXAM_ALREADY_SUBMITTED")
  })
})

describe("submitExam", () => {
  it("posts the token and all answers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { state: "submitted" } }))
    vi.stubGlobal("fetch", fetchMock)
    await submitExam("tok", { "1": { verdict: "no" } })
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe("/exam/submit")
    expect(JSON.parse(init.body)).toEqual({ t: "tok", answers: { "1": { verdict: "no" } } })
  })
})
