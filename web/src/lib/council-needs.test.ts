import { ME, NOW, OLA, applicant, bookmarkBy, editItem, queueItem } from "@/test/council-fixtures"
import { describe, expect, it } from "vitest"
import { type NeedsInput, deriveNeeds } from "./council-needs"

const HOUR = 3600
const DAY = 86400

function input(overrides: Partial<NeedsInput> = {}): NeedsInput {
  return { queue: [], edits: [], applicants: [], meKeyId: ME.keyId, now: NOW, ...overrides }
}

describe("deriveNeeds", () => {
  it("is empty when nothing needs attention", () => {
    expect(deriveNeeds(input())).toEqual([])
  })

  it("points at the oldest edit to a sealed lyric first", () => {
    const needs = deriveNeeds(
      input({
        edits: [
          editItem({ revisionId: 1, pendingReason: "sealed", createdAt: NOW - 3 * HOUR, song: "Newer" }),
          editItem({
            revisionId: 2,
            pendingReason: "sealed",
            createdAt: NOW - 2 * DAY - 6 * HOUR,
            song: "Isn't She Lovely",
            revNo: 4,
            liveRevNo: 3,
          }),
        ],
      }),
    )
    expect(needs[0]).toMatchObject({
      kind: "sealed-edit",
      tone: "gold",
      title: "Edit to sealed lyric “Isn't She Lovely”",
      sub: "Rev 4 would replace the live sealed Rev 3 · waiting 2d",
      to: "/council/edits?item=2",
    })
    expect(needs).toHaveLength(1)
  })

  it("names the Jev score of a flagged edit", () => {
    const [need] = deriveNeeds(
      input({ edits: [editItem({ pendingReason: "flagged", jevProbability: 0.84, createdAt: NOW - 28 * HOUR })] }),
    )
    expect(need).toMatchObject({
      kind: "flagged-edit",
      tone: "warn",
      title: "“Isn't She Lovely” edit flagged by Jev at 84%",
      sub: "By Yes · waiting 1d",
    })
  })

  it("counts my bookmarks and names the one that expires first", () => {
    const soon = { ...bookmarkBy(ME, 2), createdAt: NOW - 44 * HOUR, expiresAt: NOW + 28 * HOUR }
    const [need] = deriveNeeds(
      input({
        queue: [
          queueItem({ id: 1, bookmark: bookmarkBy(ME, 1) }),
          queueItem({ id: 2, song: "Run Rabbit", bookmark: soon }),
        ],
        edits: [editItem({ bookmark: bookmarkBy(ME, 3) })],
      }),
    )
    expect(need).toMatchObject({
      kind: "my-bookmarks",
      title: "You have 3 bookmarked items",
      sub: "“Run Rabbit” goes back to the open queue in 1d 4h",
      to: "/council/bookmarks",
    })
  })

  it("warns when another member's bookmark runs out within 12 hours", () => {
    const expiring = { ...bookmarkBy(OLA), expiresAt: NOW + 9 * HOUR }
    const [need] = deriveNeeds(input({ queue: [queueItem({ id: 406, song: "Catch Catch", bookmark: expiring })] }))
    expect(need).toMatchObject({
      kind: "expiring-bookmark",
      title: "olafix52's bookmark on “Catch Catch” expires soon",
      sub: "9h left · it returns to the open queue after that",
      to: "/council/queue?item=406",
    })
  })

  it("asks for an opinion on pending applicants I have not weighed in on", () => {
    const [need] = deriveNeeds(
      input({
        applicants: [
          applicant({ applicantId: 1 }),
          applicant({ applicantId: 2 }),
          applicant({ applicantId: 3, opinions: { support: [ME], object: [], notes: [], mine: "support" } }),
          applicant({ applicantId: 4, state: "failed" }),
        ],
      }),
    )
    expect(need).toMatchObject({
      kind: "applicants",
      title: "2 applicants need your opinion",
      to: "/council/applicants",
    })
  })

  describe("ordering", () => {
    it("sorts by urgency: sealed edit, flagged edit, my bookmarks, expiring bookmark, applicants", () => {
      const needs = deriveNeeds(
        input({
          queue: [
            queueItem({ id: 1, bookmark: bookmarkBy(ME) }),
            queueItem({ id: 2, bookmark: { ...bookmarkBy(OLA, 2), expiresAt: NOW + HOUR } }),
          ],
          edits: [
            editItem({ revisionId: 1, pendingReason: "flagged", jevProbability: 0.9 }),
            editItem({ revisionId: 2, pendingReason: "sealed" }),
          ],
          applicants: [applicant()],
        }),
      )
      expect(needs.map((n) => n.kind)).toEqual([
        "sealed-edit",
        "flagged-edit",
        "my-bookmarks",
        "expiring-bookmark",
        "applicants",
      ])
    })
  })

  describe("edge cases", () => {
    it("uses the singular for one bookmark and one applicant", () => {
      const needs = deriveNeeds(input({ queue: [queueItem({ bookmark: bookmarkBy(ME) })], applicants: [applicant()] }))
      expect(needs.map((n) => n.title)).toEqual(["You have 1 bookmarked item", "1 applicant needs your opinion"])
    })

    it("ignores other members' bookmarks with more than 12 hours left and my own expiring ones", () => {
      const needs = deriveNeeds(
        input({
          queue: [
            queueItem({ id: 1, bookmark: { ...bookmarkBy(OLA), expiresAt: NOW + 12 * HOUR } }),
            queueItem({ id: 2, bookmark: { ...bookmarkBy(ME, 2), expiresAt: NOW + HOUR } }),
          ],
        }),
      )
      expect(needs.map((n) => n.kind)).toEqual(["my-bookmarks"])
    })

    it("skips a bookmark that has already expired", () => {
      const needs = deriveNeeds(input({ queue: [queueItem({ bookmark: { ...bookmarkBy(OLA), expiresAt: NOW - 1 } })] }))
      expect(needs).toEqual([])
    })

    it("names an edit without an author as unknown", () => {
      const [need] = deriveNeeds(
        input({ edits: [editItem({ pendingReason: "flagged", jevProbability: null, author: null })] }),
      )
      expect(need.title).toBe("“Isn't She Lovely” edit flagged by Jev")
      expect(need.sub).toMatch(/^By an unknown author · /)
    })
  })

  describe("invariants", () => {
    it("gives every need a unique kind so it can key a list", () => {
      const needs = deriveNeeds(
        input({
          queue: [queueItem({ bookmark: bookmarkBy(ME) })],
          edits: [editItem({ pendingReason: "sealed" }), editItem({ revisionId: 7, pendingReason: "flagged" })],
          applicants: [applicant()],
        }),
      )
      expect(new Set(needs.map((n) => n.kind)).size).toBe(needs.length)
    })

    it("does not reorder its inputs", () => {
      const edits = [editItem({ revisionId: 1, pendingReason: "sealed" }), editItem({ revisionId: 2, createdAt: 1 })]
      const before = edits.map((e) => e.revisionId)
      deriveNeeds(input({ edits }))
      expect(edits.map((e) => e.revisionId)).toEqual(before)
    })
  })
})
