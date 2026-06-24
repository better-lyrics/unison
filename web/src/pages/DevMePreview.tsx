import { useState } from "react"
import { SessionContext } from "@/auth/AuthProvider"
import { type DiscordSectionModel, DiscordSectionView } from "@/components/DiscordSection"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { NicknameEditor } from "@/components/NicknameEditor"
import { UserProfileView } from "@/components/UserProfileView"
import { SEED_CURATORS } from "@/lib/dev-seed"

// Mirrors the Me page against a fixture session so the profile and nickname
// cards render with seed data, while the Discord card is swappable across its
// states. Nickname save/reset hit no backend here.
const curator = SEED_CURATORS[0]
const fakeSession = {
  status: "signed-in",
  extensionAvailable: true,
  identity: {
    keyId: curator.keyId,
    displayName: curator.displayName,
    expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  },
  signOut: () => {},
  updateDisplayName: (_displayName: string) => {},
} as const

const baseSection: Omit<DiscordSectionModel, "status"> = {
  username: "aurora#1234",
  connecting: false,
  working: false,
  error: null,
  onConnect: () => {},
  onDisconnect: () => {},
}

const sectionStates: { label: string; model: DiscordSectionModel }[] = [
  { label: "unlinked", model: { ...baseSection, status: "unlinked", username: null } },
  { label: "linked", model: { ...baseSection, status: "linked" } },
  { label: "linked (working)", model: { ...baseSection, status: "linked", working: true } },
  { label: "error", model: { ...baseSection, status: "linked", error: "We could not disconnect just now." } },
  { label: "loading", model: { ...baseSection, status: "loading" } },
]

const tabClass = (active: boolean) =>
  `cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-unison-border-strong bg-unison-bg-hover text-unison-text"
      : "border-unison-border bg-unison-bg-elevated text-unison-text-muted hover:text-unison-text"
  }`

export default function DevMePreview() {
  const [sectionIdx, setSectionIdx] = useState(1)

  return (
    <SessionContext.Provider value={fakeSession}>
      <div className="space-y-6">
        <UserProfileView keyId={curator.keyId} title="Me" />
        <LeaderboardSection title="Nickname" subtitle="How you appear across Unison.">
          <NicknameEditor />
        </LeaderboardSection>
        <LeaderboardSection title="Discord" subtitle="Link your account for leaderboard roles.">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {sectionStates.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  className={tabClass(i === sectionIdx)}
                  onClick={() => setSectionIdx(i)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <DiscordSectionView model={sectionStates[sectionIdx].model} />
          </div>
        </LeaderboardSection>
      </div>
    </SessionContext.Provider>
  )
}
