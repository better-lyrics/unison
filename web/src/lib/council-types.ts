import type { Confidence, LeaderboardBadge, LyricsFormat, SyncType, TierName } from "./types"

export interface Person {
  userId: number
  keyId: string
  displayName: string
  handle: string | null
  avatarUrl: string | null
}

export interface CouncilPerson extends Person {
  tier: TierName | null
  badgeCount: number
  topBadge: LeaderboardBadge | null
  featured: LeaderboardBadge[]
}

export interface BookmarkView {
  id: number
  holder: CouncilPerson
  createdAt: number
  expiresAt: number
}

export type BookmarkItemType = "seal" | "edit"

export interface CouncilBookmark extends BookmarkView {
  itemType: BookmarkItemType
  itemId: number
  lyricsId: number
}

export interface QueueSubmitter extends CouncilPerson {
  reputation: number
  submissions: number
  sealed: number
}

export interface QueueFlag {
  code: string
  label: string
}

export interface QueueItem {
  id: number
  videoId: string
  song: string
  artist: string
  format: LyricsFormat
  syncType: SyncType
  language: string | null
  confidence: Confidence
  score: number
  upvotes: number
  downvotes: number
  voteCount: number
  createdAt: number
  variants: number
  requestsFilled: number
  flags: QueueFlag[]
  submitter: QueueSubmitter | null
  bookmark: BookmarkView | null
}

export type PendingReason = "sealed" | "flagged" | "large_text_drift" | "large_timing_drift"

export interface EditItem {
  lyricsId: number
  revisionId: number
  revNo: number
  liveRevNo: number
  videoId: string
  song: string
  artist: string
  format: LyricsFormat
  pendingReason: PendingReason
  jevProbability: number | null
  textDrift: number
  timingDrift: number
  createdAt: number
  author: CouncilPerson | null
  bookmark: BookmarkView | null
}

export interface EditThresholds {
  textDrift: number
  timingDrift: number
  jevFlag: number
}

export interface EditsPayload {
  items: EditItem[]
  thresholds: EditThresholds
}

export type CouncilEventKind =
  | "seal"
  | "unseal"
  | "reject"
  | "unreject"
  | "edit_approve"
  | "edit_reject"
  | "bookmark"
  | "release"
  | "member_add"
  | "member_remove"
  | "applicant_approve"
  | "applicant_reject"

export type CouncilSource = "web" | "discord" | "admin"

export interface CouncilEvent {
  id: number
  kind: CouncilEventKind
  source: CouncilSource
  at: number
  note: string | null
  undone: boolean
  actor: Person | null
  subject: Person | null
  lyric: { id: number; videoId: string; song: string; artist: string } | null
}

export type EventGroup = "seals" | "rejections" | "edits" | "membership"

export interface EventsPage {
  events: CouncilEvent[]
  nextCursor: string | null
}

export interface BoostQuota {
  quota: number
  used: number
  remaining: number
  resetsAt: number
}

export interface DayDecisions {
  day: number
  sealed: number
  rejected: number
  editsReviewed: number
}

export interface CouncilOverview {
  decisionsByDay: DayDecisions[]
  medianDecisionHours: { current: number | null; previous: number | null }
  sealRate: number | null
  sourceSplit: { web: number; discord: number }
  me: {
    quota: BoostQuota
    rejectsThisMonth: number
    editsThisMonth: number
    medianDecisionHours: number | null
    bookmarkCap: number
    bookmarkTtlSec: number
  }
}

export interface RosterMember extends CouncilPerson {
  isYou: boolean
  isAdmin: boolean
  addedAt: number
  quota: BoostQuota
  sealsThisMonth: number
  rejectsThisMonth: number
  editsThisMonth: number
  lastActiveAt: number | null
  weekly: number[]
  lastWeek: { sealed: number; rejected: number; edits: number }
}

export type OpinionStance = "support" | "object"

export interface ApplicantView {
  applicantId: number
  discordId: string | null
  keyId: string
  displayName: string
  score: number | null
  maxScore: number | null
  cutoff: number | null
  breakdown: { section: string; score: number; max: number }[]
  submittedAt: number | null
  state: "in_progress" | "pending_review" | "failed" | "approved" | "rejected"
  decidedAt: number | null
  person: CouncilPerson | null
  retakeAt: number | null
  opinions: {
    support: CouncilPerson[]
    object: CouncilPerson[]
    notes: { by: CouncilPerson; stance: OpinionStance; note: string }[]
    mine: OpinionStance | null
  }
}
