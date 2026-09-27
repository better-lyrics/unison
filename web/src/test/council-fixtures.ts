import { type StoredSession, saveStoredSession } from "@/lib/auth"
import type {
  ApplicantView,
  CouncilOverview,
  CouncilPerson,
  EditItem,
  EditsPayload,
  EventsPage,
  QueueItem,
  RosterMember,
} from "@/lib/council-types"
import { vi } from "vitest"
import { fetchRouter, jsonResponse } from "./fetch-router"

export const NOW = 1_790_000_000
const HOUR = 3600
const DAY = 86400

export const ME: CouncilPerson = {
  userId: 1,
  keyId: "b0".repeat(32),
  displayName: "boidu",
  handle: "boidu",
  avatarUrl: "https://cdn.betterlyrics.org/avatars/face-paint.webp",
  tier: "elite",
}

export const OLA: CouncilPerson = {
  userId: 2,
  keyId: "01".repeat(32),
  displayName: "olafix52",
  handle: "olafix52",
  avatarUrl: null,
  tier: "elite",
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
    diffPreview: "",
    diffFull: "",
    author: { ...OLA, userId: 11, keyId: "e5".repeat(32), displayName: "Yes", handle: null },
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
      quota: { quota: 3, used: 1, remaining: 2, resetsAt: Date.UTC(2026, 9, 1, 12) / 1000 },
      rejectsThisMonth: 6,
      editsThisMonth: 9,
      medianDecisionHours: 18,
      bookmarkCap: 5,
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
    quota: { quota: 3, used: 1, remaining: 2, resetsAt: NOW + 3 * DAY },
    sealsThisMonth: 1,
    rejectsThisMonth: 6,
    editsThisMonth: 9,
    lastActiveAt: NOW - HOUR,
    weekly: [3, 5, 2, 6, 4, 7, 5, 8],
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

export interface CouncilData {
  queue: QueueItem[]
  edits: EditsPayload
  overview: CouncilOverview
  members: RosterMember[]
  applicants: ApplicantView[]
  events: EventsPage
}

export function councilData(overrides: Partial<CouncilData> = {}): CouncilData {
  return {
    queue: [],
    edits: { items: [], thresholds: { textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 } },
    overview: overview(),
    members: [rosterMember(ME), rosterMember(OLA)],
    applicants: [],
    events: { events: [], nextCursor: null },
    ...overrides,
  }
}

const ENDPOINTS: [string, keyof CouncilData][] = [
  ["/committee/queue", "queue"],
  ["/committee/edits", "edits"],
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

export function stubCouncilApi(
  data: CouncilData = councilData(),
  council: { admin: boolean } | null = { admin: false },
) {
  saveStoredSession(MEMBER_SESSION)
  const router = fetchRouter([
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
      respond: () => jsonResponse({ success: true, data: data[key] }),
    })),
  ])
  vi.stubGlobal("fetch", router.fn)
  return router
}
