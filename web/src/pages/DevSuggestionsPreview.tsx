import { SessionContext } from "@/auth/AuthProvider"
import { EditDetail } from "@/components/council/EditDetail"
import { SuggestionInboxView } from "@/components/profile/SuggestionInbox"
import {
  PickStep,
  PreviewStep,
  SuggestDialogFrame,
  SuggestEditButton,
  type SuggestFile,
  SuggestionWaitingLine,
  suggestionSentToast,
} from "@/components/song/SuggestEditButton"
import { SuggestionChangesDialog } from "@/components/song/SuggestionChanges"
import {
  type PreviewView,
  SuggestionNotice,
  SuggestionPreviewBar,
  SuggestionRail,
  SuggestionRailFold,
} from "@/components/song/SuggestionPreview"
import { buttonClass } from "@/components/ui"
import { lyricsKeys } from "@/hooks/useLyricsData"
import { usePresence } from "@/hooks/usePresence"
import type { EditItem } from "@/lib/council-types"
import { jumpTargets, previewActions } from "@/lib/lyric-suggestion"
import type { DiffRow, PreviewResult, RevisionSummary, SuggestionInboxItem } from "@/lib/revision-types"
import { pushToast } from "@/lib/toast"
import type { RevisionSuggestion, VariantFull, VariantRevision } from "@/lib/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ComponentProps, type ReactNode, useState } from "react"

type Session = ComponentProps<typeof SessionContext.Provider>["value"]

const NOW = Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86400

const OWNER_KEY = "a9".repeat(32)
const PROPOSER_KEY = "c4".repeat(32)
const COUNCIL_KEY = "5e".repeat(32)
const BYSTANDER_KEY = "70".repeat(32)
const NEWCOMER_KEY = "3b".repeat(32)

function signedIn(keyId: string, displayName: string, council = false, canSuggest = true): Session {
  return {
    status: "signed-in",
    extensionAvailable: true,
    extensionId: null,
    identity: { keyId, displayName, expiresAt: NOW + DAY, council: council ? { admin: false } : null, canSuggest },
    signOut: () => {},
    updateDisplayName: () => {},
    updateAvatarUrl: () => {},
  }
}

const SESSIONS = {
  owner: signedIn(OWNER_KEY, "Mirelle"),
  proposer: signedIn(PROPOSER_KEY, "Ren Okafor"),
  council: signedIn(COUNCIL_KEY, "Juno Park", true),
  bystander: signedIn(BYSTANDER_KEY, "Tove Lind"),
  newcomer: signedIn(NEWCOMER_KEY, "Pip Arden", false, false),
}

const LIVE_TTML = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:38.900" end="00:41.200">Salt on the screen door, summer gone grey</p>
<p begin="00:41.200" end="00:44.540">We kept the porch light burning</p>
<p begin="00:44.860" end="00:48.100">Long after the last car passed</p>
<p begin="00:48.100" end="00:51.720">And every window hummed</p>
</div></body></tt>`

const SUGGESTION: RevisionSuggestion = {
  id: 9310,
  revNo: 4,
  author: { displayName: "Ren Okafor" },
  authorKeyId: PROPOSER_KEY,
  authorAvatarUrl: null,
  note: "At 0:41 the word is hallway, not porch. I also moved 0:44 earlier, it came in late.",
  pendingReason: "suggested",
  sealed: false,
  createdAt: NOW - 3 * HOUR,
  councilDecidesAt: NOW + 6 * DAY + 21 * HOUR,
}

const OVERDUE: RevisionSuggestion = { ...SUGGESTION, createdAt: NOW - 7 * DAY - 2 * HOUR, councilDecidesAt: null }

const VARIANT: VariantFull = {
  id: 48211,
  videoId: "k4Pw2sLmQ0e",
  song: "Paper Lanterns",
  artist: "Hollow Coast",
  album: "Low Tide Radio",
  format: "ttml",
  language: "en",
  syncType: "richsync",
  score: 14,
  effectiveScore: 12.4,
  voteCount: 31,
  confidence: "high",
  hidden: false,
  lyrics: LIVE_TTML,
  submitter: {
    keyId: OWNER_KEY,
    reputation: 1.4,
    displayName: "Mirelle",
    tier: null,
    level: 14,
    badgeCount: 0,
    topBadge: null,
    featured: [],
  },
  revision: { revNo: 3, updatedAt: NOW - 12 * DAY },
}

const withRevision = (revision: Partial<VariantRevision> = {}, ownerless = false): VariantFull => ({
  ...VARIANT,
  submitter: ownerless ? undefined : VARIANT.submitter,
  revision: { revNo: 3, updatedAt: NOW - 12 * DAY, ...revision },
})

const DIFF_ROWS: DiffRow[] = [
  { kind: "field", field: "album", before: "Low Tide Radio", after: "Low Tide Radio (Deluxe)" },
  { kind: "field", field: "isrc", before: null, after: "QZHN52611042" },
  { kind: "gap", count: 12 },
  {
    kind: "word",
    lineNo: 13,
    startMs: 41_200,
    parts: [
      ["=", "We kept the "],
      ["-", "porch"],
      ["+", "hallway"],
      ["=", " light burning"],
    ],
  },
  { kind: "timing", lineNo: 14, startMs: 44_540, deltaMs: -320, text: "Long after the last car passed" },
  {
    kind: "word",
    lineNo: 15,
    startMs: 48_100,
    parts: [
      ["-", "And"],
      ["+", "Till"],
      ["=", " every window hummed"],
    ],
  },
  { kind: "same", lineNo: 16, startMs: 51_720, text: "Like it knew our names" },
  { kind: "gap", count: 26 },
]

const LONG_LINES = [
  "Salt on the screen door, summer gone grey",
  "We kept the hallway light burning",
  "Long after the last car passed",
  "And every window hummed",
  "Like it knew our names",
  "Paper lanterns on the fence line",
]

const LONG_DIFF_ROWS: DiffRow[] = Array.from({ length: 24 }, (_, i) => ({
  kind: "timing",
  lineNo: i + 1,
  startMs: 12_400 + i * 4_150,
  deltaMs: i % 3 === 0 ? -240 : 180,
  text: LONG_LINES[i % LONG_LINES.length],
}))

const PASSING: PreviewResult = {
  checks: [
    { field: "lyrics", status: "ok", message: "TTML, richsync, 42 lines." },
    { field: "language", status: "ok", message: "Language: en.", language: "en" },
    { field: "isrc", status: "ok", message: "ISRC: QZHN52611042." },
    { field: "album", status: "ok", message: "Album: Low Tide Radio (Deluxe)." },
  ],
  outcome: { goesLive: false, reason: "suggested" },
  noChanges: false,
  rateLimit: { lyricRemaining: 2, lyricLimit: 3, userRemaining: 9, userLimit: 10 },
  diff: { rows: DIFF_ROWS, againstRevNo: 3 },
}

const FAILING: PreviewResult = {
  ...PASSING,
  checks: [
    {
      field: "lyrics",
      status: "bad",
      message: "The TTML is not well formed. Line 18, column 34: </span> closes a <p> that opened on line 17.",
      line: 18,
    },
    { field: "isrc", status: "ok", message: "ISRC: QZHN52611042." },
  ],
}

const FILE: SuggestFile = {
  input: { lyrics: LIVE_TTML, format: "ttml" },
  name: "paper-lanterns-fixed.ttml",
  bytes: 4301,
}

const INBOX: SuggestionInboxItem[] = [
  {
    lyricsId: VARIANT.id,
    videoId: VARIANT.videoId,
    song: VARIANT.song,
    artist: VARIANT.artist,
    suggestion: SUGGESTION,
  },
  {
    lyricsId: 51907,
    videoId: "Qz7nW1xYb3c",
    song: "Glass Orchard",
    artist: "The Quiet Fathoms",
    suggestion: {
      ...SUGGESTION,
      id: 9402,
      revNo: 7,
      author: { displayName: "Tove Lind" },
      authorKeyId: BYSTANDER_KEY,
      note: null,
      pendingReason: "large_text_drift",
      createdAt: NOW - DAY,
      councilDecidesAt: null,
    },
  },
]

const REVISIONS: RevisionSummary[] = [
  {
    id: 9103,
    revNo: 3,
    status: "live",
    pendingReason: null,
    isAnchor: false,
    textDrift: 0.04,
    timingDrift: 0.02,
    revertsRevNo: null,
    author: { displayName: "Mirelle" },
    reviewNote: null,
    createdAt: NOW - 12 * DAY,
    reviewedAt: null,
  },
]

const EDIT: EditItem = {
  lyricsId: VARIANT.id,
  revisionId: OVERDUE.id,
  revNo: 4,
  liveRevNo: 3,
  videoId: VARIANT.videoId,
  song: VARIANT.song,
  artist: VARIANT.artist,
  format: "ttml",
  pendingReason: "suggested",
  jevProbability: 0.06,
  textDrift: 0.04,
  timingDrift: 0.02,
  createdAt: OVERDUE.createdAt,
  author: {
    userId: 31,
    keyId: PROPOSER_KEY,
    displayName: "Ren Okafor",
    handle: "renokafor",
    avatarUrl: null,
    tier: null,
    badgeCount: 0,
    topBadge: null,
    featured: [],
  },
  suggestion: true,
  ownerless: false,
  authorNote: SUGGESTION.note,
  bookmark: null,
}

function fixtureClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false },
    },
  })
  for (const item of [...INBOX, { lyricsId: EDIT.lyricsId, suggestion: OVERDUE }]) {
    client.setQueryData(lyricsKeys.diff(item.lyricsId, item.suggestion.id), { rows: DIFF_ROWS, againstRevNo: 3 })
  }
  client.setQueryData(lyricsKeys.revisions(EDIT.lyricsId), REVISIONS)
  return client
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">{title}</h2>
        {note ? <p className="mt-1 text-xs text-unison-text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-unison-text-muted">{label}</p>
      {children}
    </div>
  )
}

type DialogFixture = "pick" | "passing" | "failing" | "ownerless"

function DialogFixtures() {
  const [fixture, setFixture] = useState<DialogFixture>("pick")
  const [open, setOpen] = useState(false)
  const dialog = usePresence(open, "--modal-close-dur")
  const [note, setNote] = useState(SUGGESTION.note ?? "")
  const close = () => setOpen(false)
  const opener = (next: DialogFixture, label: string) => (
    <button
      type="button"
      className={buttonClass("fill", "sm")}
      onClick={() => {
        setFixture(next)
        setOpen(true)
      }}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap gap-2">
      {opener("pick", "Step 1")}
      {opener("passing", "Step 2, checks pass")}
      {opener("failing", "Step 2, a check fails")}
      {opener("ownerless", "Step 2, lyric has no owner")}
      <button
        type="button"
        className={buttonClass("fill", "sm")}
        onClick={() => suggestionSentToast("Mirelle", "owner")}
      >
        Sent toast
      </button>
      <button
        type="button"
        className={buttonClass("fill", "sm")}
        onClick={() => suggestionSentToast("Mirelle", "council")}
      >
        Sent toast, council decides
      </button>
      {dialog.mounted ? (
        <SuggestDialogFrame open={open} step={fixture === "pick" ? 1 : 2} onClose={close}>
          {fixture === "pick" ? (
            <PickStep variant={VARIANT} error={null} onFile={() => setFixture("passing")} onCancel={close} />
          ) : (
            <PreviewStep
              variant={fixture === "ownerless" ? withRevision({}, true) : VARIANT}
              file={FILE}
              result={fixture === "failing" ? FAILING : PASSING}
              note={note}
              onNote={setNote}
              sending={false}
              error={null}
              onBack={() => setFixture("pick")}
              onReplace={() => setFixture("passing")}
              onSend={() => {
                suggestionSentToast("Mirelle", fixture === "ownerless" ? "council" : "owner")
                close()
              }}
            />
          )}
        </SuggestDialogFrame>
      ) : null}
    </div>
  )
}

const ACTION_STATES: {
  label: string
  session: Session
  revision?: Partial<VariantRevision>
  ownerless?: boolean
}[] = [
  { label: "Signed out", session: null, revision: { suggestion: SUGGESTION } },
  { label: "Anyone signed in", session: SESSIONS.bystander },
  { label: "No lyric of their own yet", session: SESSIONS.newcomer, revision: { suggestion: SUGGESTION } },
  { label: "Owner: no action", session: SESSIONS.owner, revision: { suggestion: SUGGESTION } },
  { label: "One already waiting", session: SESSIONS.bystander, revision: { suggestion: SUGGESTION } },
  {
    label: "Owner's own edit waiting",
    session: SESSIONS.bystander,
    revision: { pending: { revNo: 4, pendingReason: "large_text_drift" } },
  },
  { label: "You suggested it", session: SESSIONS.proposer, revision: { suggestion: SUGGESTION } },
  {
    label: "You suggested it, council decides",
    session: SESSIONS.proposer,
    revision: { suggestion: { ...SUGGESTION, pendingReason: "flagged", councilDecidesAt: null } },
  },
  {
    label: "You suggested it, lyric has no owner",
    session: SESSIONS.proposer,
    revision: { suggestion: { ...SUGGESTION, councilDecidesAt: null } },
    ownerless: true,
  },
]

const PREVIEW_ROLES: { label: string; viewer: keyof typeof SESSIONS; suggestion: RevisionSuggestion }[] = [
  { label: "Owner", viewer: "owner", suggestion: SUGGESTION },
  { label: "Owner, council decides", viewer: "owner", suggestion: INBOX[1].suggestion },
  { label: "Council, after 7 days", viewer: "council", suggestion: OVERDUE },
  { label: "Proposer", viewer: "proposer", suggestion: SUGGESTION },
  { label: "Anyone else", viewer: "bystander", suggestion: SUGGESTION },
]

function viewerOf(key: keyof typeof SESSIONS) {
  const session = SESSIONS[key]
  if (session?.status !== "signed-in") return null
  return {
    keyId: session.identity.keyId,
    council: Boolean(session.identity.council),
    canSuggest: session.identity.canSuggest !== false,
  }
}

function PreviewFixtures() {
  const [view, setView] = useState<PreviewView>("suggestion")
  const jumps = jumpTargets(DIFF_ROWS)
  const longJumps = jumpTargets(LONG_DIFF_ROWS)
  const announceJump = (seconds: number) =>
    pushToast({ kind: "info", message: `Would play from ${seconds.toFixed(1)} s` })
  return (
    <div className="flex flex-col gap-8">
      {PREVIEW_ROLES.map(({ label, viewer, suggestion }) => (
        <Labeled key={label} label={label}>
          <SuggestionPreviewBar
            item={{ ...INBOX[0], suggestion }}
            liveRevNo={3}
            actionsFor={(content) =>
              previewActions(viewerOf(viewer), { submitterKeyId: OWNER_KEY, suggestion, content })
            }
            content="loaded"
            view={view}
            onView={setView}
            onDone={() => pushToast({ kind: "info", message: "Would leave the preview" })}
            now={NOW}
          />
        </Labeled>
      ))}
      <div className="grid gap-6 min-[900px]:grid-cols-2">
        <Labeled label="Rail while previewing">
          <SuggestionRail suggestion={SUGGESTION} jumps={jumps} onJump={(jump) => announceJump(jump.seekSeconds)} />
        </Labeled>
        <Labeled label="Narrow screens: under the bar, folded">
          <SuggestionRailFold
            suggestion={SUGGESTION}
            jumps={longJumps}
            onJump={(jump) => announceJump(jump.seekSeconds)}
          />
        </Labeled>
        <Labeled label="Rail, large change">
          <SuggestionRail
            suggestion={{ ...SUGGESTION, note: null }}
            jumps={longJumps}
            onJump={(jump) => announceJump(jump.seekSeconds)}
          />
        </Labeled>
        <Labeled label="Owner already on the song page">
          <SuggestionNotice
            suggestion={SUGGESTION}
            actions={previewActions(viewerOf("owner"), {
              submitterKeyId: OWNER_KEY,
              suggestion: SUGGESTION,
              content: "loaded",
            })}
            now={NOW}
            onPreview={() => pushToast({ kind: "info", message: "Would open the preview" })}
          />
        </Labeled>
      </div>
    </div>
  )
}

function ChangesFixture() {
  const [open, setOpen] = useState(false)
  const dialog = usePresence(open, "--modal-close-dur")
  return (
    <div>
      <button type="button" className={buttonClass("fill", "sm")} onClick={() => setOpen(true)}>
        Open the changes as the owner
      </button>
      {dialog.mounted ? (
        <SuggestionChangesDialog
          open={open}
          item={INBOX[0]}
          actionsFor={(content) =>
            previewActions(viewerOf("owner"), { submitterKeyId: OWNER_KEY, suggestion: SUGGESTION, content })
          }
          now={NOW}
          previewPath="/dev/suggestions"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

export default function DevSuggestionsPreview() {
  const [client] = useState(fixtureClient)
  return (
    <QueryClientProvider client={client}>
      <div className="flex flex-col gap-14 pb-24">
        <header>
          <h1 className="text-2xl font-bold tracking-[-0.015em]">Suggested edits</h1>
          <p className="mt-1 text-[13px] text-unison-text-muted">
            The real components with invented fixtures. Decisions and uploads call the API and fail here.
          </p>
        </header>

        <Group title="1. Suggest action">
          <div className="grid gap-4 min-[700px]:grid-cols-3">
            {ACTION_STATES.map(({ label, session, revision, ownerless }) => (
              <SessionContext.Provider key={label} value={session}>
                <Labeled label={label}>
                  <div className="flex min-h-[30px] flex-wrap items-center gap-2">
                    <SuggestEditButton variant={withRevision(revision, ownerless)} />
                  </div>
                  <SuggestionWaitingLine variant={withRevision(revision, ownerless)} />
                </Labeled>
              </SessionContext.Provider>
            ))}
          </div>
        </Group>

        <Group title="2. Suggest dialog" note="Each opens the real dialog. Only one is open at a time.">
          <DialogFixtures />
        </Group>

        <Group title="3. Owner's profile list">
          <SessionContext.Provider value={SESSIONS.owner}>
            <SuggestionInboxView items={INBOX} viewer={viewerOf("owner")} now={NOW} />
          </SessionContext.Provider>
        </Group>

        <Group
          title="4. Preview bar and rail"
          note="Shown without the lyrics view: the song page holds the one lyrics renderer. The switch is shared across the bars."
        >
          <PreviewFixtures />
        </Group>

        <Group title="5. See changes, then decide">
          <ChangesFixture />
        </Group>

        <Group title="6. Council edit detail">
          <SessionContext.Provider value={SESSIONS.council}>
            {[EDIT, { ...EDIT, ownerless: true }].map((item) => (
              <Labeled
                key={String(item.ownerless)}
                label={item.ownerless ? "Lyric has no owner" : "Owner did not decide"}
              >
                <EditDetail
                  item={item}
                  thresholds={{ textDrift: 0.15, timingDrift: 0.3, jevFlag: 0.7 }}
                  now={NOW}
                  bookmark={{ kind: "open", capped: false, cap: 3 }}
                  bookmarkPending={false}
                  onBookmark={() => {}}
                  onApprove={() => pushToast({ kind: "info", message: "Would approve" })}
                  onReject={() => pushToast({ kind: "info", message: "Would reject" })}
                  busy={false}
                />
              </Labeled>
            ))}
          </SessionContext.Provider>
        </Group>
      </div>
    </QueryClientProvider>
  )
}
