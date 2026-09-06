import { DiscordSection } from "@/components/DiscordSection"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { NicknameEditor } from "@/components/NicknameEditor"

// The signed-in owner's editing controls, shown on their own profile wherever it renders.
export function OwnerControls() {
  return (
    <>
      <LeaderboardSection title="Nickname" subtitle="How you appear across Unison.">
        <NicknameEditor />
      </LeaderboardSection>
      <LeaderboardSection title="Discord" subtitle="Link your account for leaderboard roles.">
        <DiscordSection />
      </LeaderboardSection>
    </>
  )
}
