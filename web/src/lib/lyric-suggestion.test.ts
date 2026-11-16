import { describe, expect, it } from "vitest"
import { COMMUNITY_KEY_ID as SERVER_COMMUNITY_KEY_ID, config } from "../../../src/config"
import { COMMUNITY_KEY_ID } from "./community"
import {
  JUMP_LEAD_IN_MS,
  type SuggestionContent,
  isOwnSuggestion,
  isOwnerless,
  jumpTargets,
  lyricsFormatOf,
  previewActions,
  suggestAction,
} from "./lyric-suggestion"
import type { DiffRow } from "./revision-types"
import type { PendingReason, RevisionSuggestion } from "./types"

const OWNER = { keyId: "owner-key" }
const VISITOR = { keyId: "visitor-key" }

const waiting = (authorKeyId: string): RevisionSuggestion => ({
  id: 41,
  revNo: 3,
  author: { displayName: "Tamsin" },
  authorKeyId,
  authorAvatarUrl: null,
  note: null,
  pendingReason: "suggested",
  sealed: false,
  createdAt: 1_700_000_000,
  councilDecidesAt: 1_700_604_800,
  rejectNoteMaxLength: config.validation.report.maxDetailsLength,
  decider: "owner",
})

describe("suggestAction", () => {
  it("lets a signed-in visitor suggest an edit to someone else's lyric", () => {
    expect(suggestAction(VISITOR, { submitterKeyId: OWNER.keyId })).toBe("suggest")
  })

  it("never offers the owner a suggestion, even when one is waiting on them", () => {
    expect(suggestAction(OWNER, { submitterKeyId: OWNER.keyId, suggestion: waiting(VISITOR.keyId) })).toBe("none")
  })

  it("asks a signed-out visitor to sign in", () => {
    expect(suggestAction(null, { submitterKeyId: OWNER.keyId })).toBe("sign-in")
  })

  it("offers the author of the waiting suggestion a withdraw, and everyone else a wait", () => {
    const lyric = { submitterKeyId: OWNER.keyId, suggestion: waiting(VISITOR.keyId) }
    expect(suggestAction(VISITOR, lyric)).toBe("withdraw")
    expect(suggestAction({ keyId: "third-key" }, lyric)).toBe("waiting")
  })

  it("asks a signed-out visitor to sign in before telling them one is waiting", () => {
    expect(suggestAction(null, { submitterKeyId: OWNER.keyId, suggestion: waiting(VISITOR.keyId) })).toBe("sign-in")
  })

  it("makes everyone else wait while the owner's own edit is pending", () => {
    const lyric = { submitterKeyId: OWNER.keyId, pending: { revNo: 4, pendingReason: "large_text_drift" as const } }
    expect(suggestAction(VISITOR, lyric)).toBe("waiting")
  })

  it("asks a visitor with no lyric of their own to add one before telling them one is waiting", () => {
    const newcomer = { keyId: "newcomer-key", canSuggest: false }
    expect(suggestAction(newcomer, { submitterKeyId: OWNER.keyId })).toBe("needs-lyric")
    expect(suggestAction(newcomer, { submitterKeyId: OWNER.keyId, suggestion: waiting(VISITOR.keyId) })).toBe(
      "needs-lyric",
    )
    expect(suggestAction(null, { submitterKeyId: OWNER.keyId })).toBe("sign-in")
  })

  it("still lets the author of a waiting suggestion withdraw it below the floor", () => {
    const author = { keyId: VISITOR.keyId, canSuggest: false }
    expect(suggestAction(author, { submitterKeyId: OWNER.keyId, suggestion: waiting(VISITOR.keyId) })).toBe("withdraw")
  })
})

describe("isOwnerless", () => {
  it("leaves a suggestion on a lyric with no owner to the council", () => {
    expect(isOwnerless(null)).toBe(true)
    expect(isOwnerless(COMMUNITY_KEY_ID)).toBe(true)
    expect(isOwnerless(OWNER.keyId)).toBe(false)
  })
})

describe("previewActions", () => {
  const lyric = (overrides: Partial<RevisionSuggestion> = {}, sealed = false) => ({
    submitterKeyId: OWNER.keyId,
    suggestion: { ...waiting(VISITOR.keyId), sealed, ...overrides },
    content: "loaded" as const,
  })
  const viewer = (keyId: string, council = false) => ({ keyId, council })

  it("lets the owner approve or reject a plain suggestion", () => {
    expect(previewActions(viewer(OWNER.keyId), lyric())).toEqual({
      approve: "available",
      reject: true,
      withdraw: false,
    })
  })

  it("leaves approval to the council when the suggestion was held for another reason or the lyric is sealed", () => {
    const councilDecides = { approve: "council-decides", reject: true, withdraw: false }
    expect(
      previewActions(viewer(OWNER.keyId), lyric({ pendingReason: "large_text_drift", decider: "council" })),
    ).toEqual(councilDecides)
    expect(previewActions(viewer(OWNER.keyId), lyric({ councilDecidesAt: null, decider: "council" }, true))).toEqual(
      councilDecides,
    )
  })

  it("lets a council member decide only once the owner's window has closed", () => {
    const decides = { approve: "available", reject: true, withdraw: false }
    expect(previewActions(viewer("council-key", true), lyric({ councilDecidesAt: null }))).toEqual(decides)
    expect(previewActions(viewer("council-key", true), lyric())).toEqual({
      approve: "hidden",
      reject: false,
      withdraw: false,
    })
  })

  it("lets an owner on the council approve a sealed suggestion, as the server does", () => {
    expect(previewActions(viewer(OWNER.keyId, true), lyric({ councilDecidesAt: null }, true)).approve).toBe("available")
  })

  it("offers the proposer only a withdraw, even when they sit on the council", () => {
    expect(previewActions(viewer(VISITOR.keyId, true), lyric({ councilDecidesAt: null }))).toEqual({
      approve: "hidden",
      reject: false,
      withdraw: true,
    })
    expect(isOwnSuggestion(viewer(VISITOR.keyId, true), VISITOR.keyId)).toBe(true)
  })

  it("lets nobody decide until the content on screen has loaded, but keeps the proposer's withdraw", () => {
    const shown = (content: SuggestionContent, overrides: Partial<RevisionSuggestion> = {}) => ({
      ...lyric(overrides),
      content,
    })
    for (const [content, approve] of [
      ["loading", "loading"],
      ["failed", "not-loaded"],
    ] as const) {
      const blocked = { approve, reject: false, withdraw: false }
      expect(previewActions(viewer(OWNER.keyId), shown(content))).toEqual(blocked)
      expect(previewActions(viewer("council-key", true), shown(content, { councilDecidesAt: null }))).toEqual(blocked)
      expect(previewActions(viewer(VISITOR.keyId), shown(content)).withdraw).toBe(true)
    }
    expect(previewActions(viewer(OWNER.keyId), shown("loaded")).approve).toBe("available")
  })

  it("gives everyone else nothing to act on", () => {
    const nothing = { approve: "hidden", reject: false, withdraw: false }
    expect(previewActions(viewer("third-key"), lyric())).toEqual(nothing)
    expect(previewActions(null, lyric())).toEqual(nothing)
  })
})

interface ServerDecisionRule {
  suggestionDecider: (reason: PendingReason | null, sealed: boolean, ownerless: boolean) => "owner" | "council"
  councilDecidesAt: (
    reason: PendingReason | null,
    sealed: boolean,
    ownerless: boolean,
    createdAt: number,
    now: number,
  ) => number | null
  decisionRole: (input: {
    action: "approve" | "reject"
    reviewerId: number
    isCouncil: boolean
    submitterId: number | null
    authorId: number | null
    reason: PendingReason | null
    sealed: boolean
    ownerless: boolean
    createdAt: number
    now: number
  }) => { ok: boolean }
}

const [{ councilDecidesAt, decisionRole, suggestionDecider }] = Object.values(
  import.meta.glob<ServerDecisionRule>("../../../src/utils/lyric-patch.ts", { eager: true }),
)

describe("decision parity with the server", () => {
  const NOW = 1_700_000_000
  const IDS = { author: 2, other: 3 }
  const KEYS = { author: "author-key", other: "other-key" }
  const OWNERS = [
    { name: "owned lyric", id: 1, keyId: "owner-key" },
    { name: "community lyric", id: 9, keyId: COMMUNITY_KEY_ID },
    { name: "lyric with no submitter", id: null, keyId: null },
  ]
  const ROLES = [
    { name: "owner", as: "owner", council: false },
    { name: "owner on the council", as: "owner", council: true },
    { name: "author", as: "author", council: false },
    { name: "author on the council", as: "author", council: true },
    { name: "council member", as: "other", council: true },
    { name: "stranger", as: "other", council: false },
  ] as const
  const REASONS: PendingReason[] = ["suggested", "sealed", "flagged", "large_text_drift", "large_timing_drift"]
  const AGES = { "inside the owner window": 3600, "after the owner window": config.revisions.ownerDecisionSec + 3600 }

  it("holds the community key equal to the server's", () => {
    expect(COMMUNITY_KEY_ID).toBe(SERVER_COMMUNITY_KEY_ID)
  })

  it("lets the same people approve and reject on the web as on the server", () => {
    for (const owner of OWNERS) {
      const ownerless = owner.id === null || owner.keyId === SERVER_COMMUNITY_KEY_ID
      for (const role of ROLES) {
        const reviewer = role.as === "owner" ? owner : { id: IDS[role.as], keyId: KEYS[role.as] }
        if (reviewer.id === null || reviewer.keyId === null) continue
        for (const reason of REASONS) {
          for (const sealed of [false, true]) {
            for (const [age, ageSec] of Object.entries(AGES)) {
              const createdAt = NOW - ageSec
              const server = (action: "approve" | "reject") =>
                decisionRole({
                  action,
                  reviewerId: reviewer.id,
                  isCouncil: role.council,
                  submitterId: owner.id,
                  authorId: IDS.author,
                  reason,
                  sealed,
                  ownerless,
                  createdAt,
                  now: NOW,
                }).ok
              const web = previewActions(
                { keyId: reviewer.keyId, council: role.council },
                {
                  submitterKeyId: owner.keyId,
                  content: "loaded",
                  suggestion: {
                    ...waiting(KEYS.author),
                    pendingReason: reason,
                    sealed,
                    createdAt,
                    councilDecidesAt: councilDecidesAt(reason, sealed, ownerless, createdAt, NOW),
                    decider: suggestionDecider(reason, sealed, ownerless),
                  },
                },
              )
              const label = `${owner.name}, ${role.name}, ${reason}, ${sealed ? "sealed" : "not sealed"}, ${age}`
              expect({ label, approve: web.approve === "available", reject: web.reject }).toEqual({
                label,
                approve: server("approve"),
                reject: server("reject"),
              })
            }
          }
        }
      }
    }
  })
})

describe("jumpTargets", () => {
  const rows: DiffRow[] = [
    { kind: "gap", count: 12 },
    {
      kind: "word",
      lineNo: 13,
      startMs: 41_200,
      parts: [
        ["=", "We kept the "],
        ["-", "porch"],
        ["+", "hallway"],
        ["=", " light on"],
      ],
    },
    { kind: "timing", lineNo: 14, startMs: 44_540, deltaMs: -320, text: "Long after the last car passed" },
    { kind: "same", lineNo: 15, startMs: 48_100, text: "Till every window hummed" },
    { kind: "add", lineNo: 16, startMs: null, text: "A line with no timing" },
    { kind: "add", lineNo: 1, startMs: null, text: "Night lamp", head: { kind: "translation", lang: "fr", line: 13 } },
    { kind: "del", lineNo: 1, startMs: 900, text: "Count in" },
  ]

  it("lists each timed change in playback order, starting a lead-in before the line and never before zero", () => {
    expect(jumpTargets(rows)).toEqual([
      { lineNo: 1, startMs: 900, seekSeconds: 0, change: "removed", text: "Count in" },
      {
        lineNo: 13,
        startMs: 41_200,
        seekSeconds: (41_200 - JUMP_LEAD_IN_MS) / 1000,
        change: "text",
        text: "We kept the hallway light on",
      },
      {
        lineNo: 14,
        startMs: 44_540,
        seekSeconds: (44_540 - JUMP_LEAD_IN_MS) / 1000,
        change: "timing",
        deltaMs: -320,
        text: "Long after the last car passed",
      },
    ])
  })
})

const [{ detectFormat }] = Object.values(
  import.meta.glob<{ detectFormat: (content: string) => string }>("../../../src/utils/validation.ts", {
    eager: true,
  }),
)

describe("lyricsFormatOf", () => {
  const ENHANCED_LRC = [
    "<00:12.40>Lanterns <00:13.10>drift <00:13.80>over <00:14.50>the <00:14.90>harbour",
    "<00:16.20>Salt <00:16.90>on <00:17.30>the <00:17.70>window <00:18.60>glass",
  ].join("\n")
  const LINE_LRC = "[00:12.40]Lanterns drift over the harbour\n[00:16.20]Salt on the window glass"
  const TTML = [
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>',
    '<p begin="00:12.400" end="00:16.200">Lanterns drift over the harbour</p>',
    "</div></body></tt>",
  ].join("")
  const PLAIN = "Lanterns drift over the harbour\nSalt on the window glass"

  it("regression: sends a word-timed LRC that opens with a word tag as LRC", () => {
    expect(lyricsFormatOf(ENHANCED_LRC)).toBe("lrc")
  })

  it("names every well-formed file the way the server detects it", () => {
    for (const text of [ENHANCED_LRC, LINE_LRC, TTML, `\n  ${TTML}`, PLAIN]) {
      expect(lyricsFormatOf(text)).toBe(detectFormat(text))
    }
  })

  it("still sends a TTML file with a broken body as TTML so the server explains what is wrong", () => {
    expect(lyricsFormatOf('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>Lanterns')).toBe("ttml")
  })
})
