import { type StoredSession, saveStoredSession } from "@/lib/auth"
import type {
  ApplicantView,
  CouncilEvent,
  CouncilOverview,
  CouncilPerson,
  EditItem,
  EditsPayload,
  EventsPage,
  MetadataItem,
  MetadataPayload,
  QueueItem,
  RosterMember,
} from "@/lib/council-types"
import { seedBadgeCatalogue } from "@/lib/dev-seed"
import type { VariantFull } from "@/lib/types"
import { vi } from "vitest"
import { type FetchRoute, fetchRouter, jsonResponse } from "./fetch-router"

export const NOW = 1_790_000_000
export const QUOTA_BASIS = { active: false, upvotedLyrics: 0, bonus: 0, monthStart: Date.UTC(2026, 7, 1) / 1000 }
export const QUOTA_RULE = { base: 6, inactive: 3, max: 12, upvotedLyricsPerSeal: 2 }
const HOUR = 3600
const DAY = 86400

const NO_BADGES = { badgeCount: 0, topBadge: null, featured: [] }

export const ME: CouncilPerson = {
  userId: 1,
  keyId: "b0".repeat(32),
  displayName: "boidu",
  handle: "boidu",
  avatarUrl: "https://cdn.betterlyrics.org/avatars/face-paint.webp",
  tier: "elite",
  ...NO_BADGES,
}

export const OLA: CouncilPerson = {
  userId: 2,
  keyId: "01".repeat(32),
  displayName: "olafix52",
  handle: "olafix52",
  avatarUrl: null,
  tier: "elite",
  ...NO_BADGES,
}

export function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 722,
    videoId: "SMQpJ9x7zEk",
    song: "Story of a Warrior",
    artist: "John Michael Howell",
    format: "ttml",
    syncType: "richsync",
    language: "en",
    confidence: "high",
    score: 0.97,
    upvotes: 38,
    downvotes: 1,
    voteCount: 39,
    createdAt: NOW - 6 * DAY,
    variants: 1,
    requestsFilled: 0,
    flags: [],
    submitter: {
      userId: 10,
      keyId: "5a".repeat(32),
      displayName: "SigmaViolinRemix",
      handle: null,
      avatarUrl: null,
      tier: "elite",
      ...NO_BADGES,
      reputation: 1.71,
      submissions: 41,
      sealed: 2,
    },
    bookmark: null,
    ...overrides,
  }
}

export function editItem(overrides: Partial<EditItem> = {}): EditItem {
  return {
    lyricsId: 669,
    revisionId: 9001,
    revNo: 4,
    liveRevNo: 3,
    videoId: "oE56g61mW44",
    song: "Isn't She Lovely",
    artist: "Stevie Wonder",
    format: "ttml",
    pendingReason: "large_text_drift",
    jevProbability: 0.12,
    textDrift: 0.23,
    timingDrift: 0.04,
    createdAt: NOW - 20 * HOUR,
    author: { ...OLA, userId: 11, keyId: "e5".repeat(32), displayName: "Yes", handle: null },
    bookmark: null,
    ...overrides,
  }
}

export function metadataItem(overrides: Partial<MetadataItem> = {}): MetadataItem {
  return {
    id: 7001,
    videoId: "oE56g61mW44",
    lyricsId: 669,
    song: "Isn't She Lovely",
    artist: "Stevie Wonder",
    before: { song: "Isn't She Lovely", artist: "Stevie Wonder", album: null },
    proposed: { song: "Isn't She Lovely", artist: "Stevie Wonder", album: "Songs in the Key of Life" },
    proposer: OLA,
    approvers: [OLA],
    createdAt: NOW - 3 * HOUR,
    bookmark: null,
    ...overrides,
  }
}

export function bookmarkBy(holder: CouncilPerson, id = 1) {
  return { id, holder, createdAt: NOW - 5 * HOUR, expiresAt: NOW + 67 * HOUR }
}

export function overview(overrides: Partial<CouncilOverview> = {}): CouncilOverview {
  return {
    decisionsByDay: [],
    medianDecisionHours: { current: 20, previous: 26 },
    sealRate: 0.3,
    sourceSplit: { web: 12, discord: 20 },
    me: {
      quota: {
        quota: 3,
        used: 1,
        remaining: 2,
        resetsAt: Date.UTC(2026, 9, 1, 12) / 1000,
        basis: QUOTA_BASIS,
        rule: QUOTA_RULE,
      },
      rejectsThisMonth: 6,
      editsThisMonth: 9,
      medianDecisionHours: 18,
      bookmarkCap: 5,
      bookmarkTtlSec: 3 * DAY,
    },
    ...overrides,
  }
}

export function rosterMember(person: CouncilPerson, overrides: Partial<RosterMember> = {}): RosterMember {
  return {
    ...person,
    isYou: person.keyId === ME.keyId,
    isAdmin: false,
    addedAt: NOW - 90 * DAY,
    quota: { quota: 3, used: 1, remaining: 2, resetsAt: NOW + 3 * DAY, basis: QUOTA_BASIS, rule: QUOTA_RULE },
    sealsThisMonth: 1,
    rejectsThisMonth: 6,
    editsThisMonth: 9,
    lastActiveAt: NOW - HOUR,
    weekly: [3, 5, 2, 6, 4, 7, 5, 8],
    lastWeek: { sealed: 1, rejected: 4, edits: 3 },
    ...overrides,
  }
}

export function applicant(overrides: Partial<ApplicantView> = {}): ApplicantView {
  return {
    applicantId: 71,
    discordId: "910875892417441823",
    keyId: "c1".repeat(32),
    displayName: "GoldenKickWhisper",
    score: 94,
    maxScore: 100,
    cutoff: 85,
    breakdown: [
      { section: "Is it exceptional?", score: 29, max: 30 },
      { section: "Timing", score: 18, max: 20 },
    ],
    submittedAt: NOW - 20 * HOUR,
    state: "pending_review",
    decidedAt: null,
    person: null,
    retakeAt: null,
    opinions: { support: [], object: [], notes: [], mine: null },
    ...overrides,
  }
}

export function councilEvent(overrides: Partial<CouncilEvent> = {}): CouncilEvent {
  return {
    id: 1,
    kind: "seal",
    source: "web",
    at: NOW - 2 * HOUR,
    note: null,
    undone: false,
    actor: { ...OLA },
    subject: null,
    lyric: { id: 722, videoId: "SMQpJ9x7zEk", song: "Story of a Warrior", artist: "John Michael Howell" },
    ...overrides,
  }
}

export function dayDecisions(days: [sealed: number, rejected: number, editsReviewed: number][]) {
  const start = Math.floor(NOW / DAY) * DAY - (days.length - 1) * DAY
  return days.map(([sealed, rejected, editsReviewed], i) => ({ day: start + i * DAY, sealed, rejected, editsReviewed }))
}

export const PREVIEW_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body dur="00:00:12.000">
    <div begin="00:00:04.000" end="00:00:11.000">
      <p begin="00:00:04.000" end="00:00:07.000"><span begin="00:00:04.000" end="00:00:05.000">Amazing </span><span begin="00:00:05.000" end="00:00:07.000">grace</span></p>
      <p begin="00:00:08.000" end="00:00:11.000">How sweet the sound</p>
    </div>
  </body>
</tt>`

export function variantFull(item: QueueItem, overrides: Partial<VariantFull> = {}): VariantFull {
  return {
    id: item.id,
    videoId: item.videoId,
    song: item.song,
    artist: item.artist,
    format: "ttml",
    syncType: "richsync",
    score: 38,
    effectiveScore: item.score,
    voteCount: item.voteCount,
    confidence: item.confidence,
    hidden: false,
    lyrics: PREVIEW_TTML,
    ...overrides,
  }
}

export interface CouncilData {
  queue: QueueItem[]
  edits: EditsPayload
  metadata: MetadataPayload
  overview: CouncilOverview
  members: RosterMember[]
  applicants: ApplicantView[]
  events: EventsPage
  myOverview?: CouncilOverview
  variants?: VariantFull[]
  sealable?: Record<string, QueueItem[]>
}

export function councilData(overrides: Partial<CouncilData> = {}): CouncilData {
  return {
    queue: [],
    edits: { items: [], thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 } },
    metadata: { items: [], needed: 3 },
    overview: overview(),
    members: [rosterMember(ME), rosterMember(OLA)],
    applicants: [],
    events: { events: [], nextCursor: null },
    ...overrides,
  }
}

const ENDPOINTS: [string, Exclude<keyof CouncilData, "myOverview">][] = [
  ["/committee/queue", "queue"],
  ["/committee/edits", "edits"],
  ["/committee/metadata", "metadata"],
  ["/committee/overview", "overview"],
  ["/committee/members", "members"],
  ["/committee/applicants", "applicants"],
  ["/committee/events", "events"],
]

export const MEMBER_SESSION: StoredSession = {
  sessionToken: "tok",
  keyId: ME.keyId,
  displayName: ME.displayName,
  expiresAt: NOW + 1000 * DAY,
}

function eventsPage(url: string, page: EventsPage): EventsPage {
  const limit = new URLSearchParams(url.split("?")[1]).get("limit")
  return limit === null ? page : { ...page, events: page.events.slice(0, Number(limit)) }
}

export function stubCouncilApi(
  data: CouncilData = councilData(),
  council: { admin: boolean } | null = { admin: false },
  extra: FetchRoute[] = [],
) {
  saveStoredSession(MEMBER_SESSION)
  const router = fetchRouter([
    ...extra,
    {
      match: (url) => url.startsWith("/lyrics/variants/"),
      respond: (url) => {
        const videoId = decodeURIComponent(url.split("/").pop() ?? "")
        const variants = (data.variants ?? []).filter((v) => v.videoId === videoId)
        return jsonResponse({ success: true, data: variants.map(({ lyrics: _, ...summary }) => summary) })
      },
    },
    {
      match: (url, init) => (init?.method ?? "GET") === "GET" && /^\/lyrics\/\d+$/.test(url),
      respond: (url) => {
        const id = Number(url.split("/").pop())
        const variant = data.variants?.find((v) => v.id === id)
        return variant
          ? jsonResponse({ success: true, data: variant })
          : jsonResponse({ success: false, error: "Not found" }, 404)
      },
    },
    {
      match: (url) => url.startsWith("/committee/queue/video/"),
      respond: (url) => {
        const videoId = decodeURIComponent(url.split("/").pop() ?? "")
        return jsonResponse({ success: true, data: data.sealable?.[videoId] ?? [] })
      },
    },
    {
      match: (url) => url === "/badges",
      respond: async () => jsonResponse({ success: true, data: await seedBadgeCatalogue() }),
    },
    {
      match: (url) => url.startsWith("/artwork?"),
      respond: () => jsonResponse({ success: true, data: { artworkUrl: null } }),
    },
    {
      match: (url) => url === "/auth/me",
      respond: () =>
        jsonResponse({
          success: true,
          data: { keyId: ME.keyId, displayName: ME.displayName, expiresAt: MEMBER_SESSION.expiresAt, council },
        }),
    },
    ...ENDPOINTS.map(([path, key]) => ({
      match: (url: string, init?: RequestInit) => (init?.method ?? "GET") === "GET" && url.split("?")[0] === path,
      respond: (url: string) =>
        jsonResponse({
          success: true,
          data: url.includes("scope=me")
            ? (data.myOverview ?? data.overview)
            : key === "events"
              ? eventsPage(url, data.events)
              : data[key],
        }),
    })),
  ])
  vi.stubGlobal("fetch", router.fn)
  return router
}
