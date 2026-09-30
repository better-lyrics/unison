import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StoredSession } from "./auth"

const loadStoredSessionMock = vi.fn<() => StoredSession | null>()

vi.mock("@/lib/auth", () => ({
  loadStoredSession: () => loadStoredSessionMock(),
}))

import {
  addCouncilMember,
  createBookmark,
  decideApplicant,
  decideEdit,
  fetchCouncilApplicants,
  fetchCouncilEvents,
  fetchCouncilOverview,
  fetchCouncilQueue,
  rejectLyric,
  releaseBookmark,
  removeCouncilMember,
  sealLyric,
  setApplicantOpinion,
  undoRejectLyric,
  unsealLyric,
} from "./council-api"

const SESSION: StoredSession = { sessionToken: "tok", keyId: "k", displayName: "Mira", expiresAt: 9e9 }

beforeEach(() => {
  loadStoredSessionMock.mockReturnValue(SESSION)
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(): {
  url: string
  method: string
  body: unknown
  auth: string | null
  contentType: string | null
} {
  const [input, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit | undefined]
  const headers = new Headers(init?.headers)
  return {
    url: input,
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(init.body as string) : undefined,
    auth: headers.get("authorization"),
    contentType: headers.get("content-type"),
  }
}

describe("council reads", () => {
  it("sends the session bearer on queue reads", async () => {
    await fetchCouncilQueue()
    expect(lastCall()).toMatchObject({ url: "/committee/queue", method: "GET", auth: "Bearer tok" })
  })

  it("builds the activity query from filters", async () => {
    await fetchCouncilEvents({ kind: "seals", actor: "abc", lyric: 7, includeBookmarks: true, cursor: "10:4" })
    const url = new URL(lastCall().url, "http://x")
    expect(url.pathname).toBe("/committee/events")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "seals",
      actor: "abc",
      lyric: "7",
      includeBookmarks: "1",
      cursor: "10:4",
    })
  })

  it("omits empty activity filters", async () => {
    await fetchCouncilEvents({})
    expect(lastCall().url).toBe("/committee/events")
  })

  it("asks for my overview and near-miss applicants", async () => {
    await fetchCouncilOverview("me")
    expect(lastCall().url).toBe("/committee/overview?scope=me")
    await fetchCouncilApplicants(true)
    expect(lastCall().url).toBe("/committee/applicants?includeBelowCutoff=1")
    await fetchCouncilApplicants(false)
    expect(lastCall().url).toBe("/committee/applicants")
  })
})

describe("council writes", () => {
  it("routes each decision to its endpoint", async () => {
    await sealLyric(5)
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/boost", method: "POST" })
    await unsealLyric(5)
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/boost", method: "DELETE" })
    await rejectLyric(5, "late chorus")
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/reject", method: "POST", body: { note: "late chorus" } })
    await undoRejectLyric(5, 11)
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/reject?rejection=11", method: "DELETE" })
    await decideEdit(5, 9, "approve")
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/revisions/9/approve", method: "POST" })
    await decideEdit(5, 9, "reject", "keep the hymn")
    expect(lastCall()).toMatchObject({ url: "/lyrics/5/revisions/9/reject", body: { note: "keep the hymn" } })
  })

  it("returns the id of the rejection the server recorded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { rejectionId: 11 } }), { status: 200 }),
    )
    expect(await rejectLyric(5, null)).toBe(11)
  })

  it("sends bookmark, opinion and membership writes", async () => {
    await createBookmark("edit", 12)
    expect(lastCall()).toMatchObject({
      url: "/committee/bookmarks",
      method: "POST",
      body: { itemType: "edit", itemId: 12 },
    })
    await releaseBookmark(3)
    expect(lastCall()).toMatchObject({ url: "/committee/bookmarks/3", method: "DELETE" })
    await setApplicantOpinion(4, null)
    expect(lastCall()).toMatchObject({ url: "/committee/applicants/4/opinion", method: "PUT", body: { stance: null } })
    await decideApplicant(4, "approve")
    expect(lastCall()).toMatchObject({ url: "/committee/applicants/4/decision", body: { decision: "approve" } })
    await addCouncilMember("abc")
    expect(lastCall()).toMatchObject({ url: "/committee/members", body: { keyId: "abc" } })
    await removeCouncilMember("a/b")
    expect(lastCall()).toMatchObject({ url: "/committee/members/a%2Fb", method: "DELETE" })
  })

  it("surfaces the server hint on a failed write", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Bookmark limit reached", code: "BOOKMARK_CAP" }), {
        status: 409,
      }),
    )
    await expect(createBookmark("seal", 1)).rejects.toThrow("Bookmark limit reached")
  })
})

describe("regressions", () => {
  it("sends no JSON content type on a DELETE without a body, which the server rejects as a bad parse", async () => {
    for (const call of [
      () => releaseBookmark(3),
      () => unsealLyric(5),
      () => undoRejectLyric(5, 11),
      () => removeCouncilMember("abc"),
    ]) {
      await call()
      expect(lastCall()).toMatchObject({ method: "DELETE", contentType: null, body: undefined })
    }
  })

  it("still labels a write that has a body as JSON", async () => {
    await createBookmark("seal", 1)
    expect(lastCall().contentType).toBe("application/json")
  })
})
