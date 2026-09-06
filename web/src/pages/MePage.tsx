import { useSession } from "@/auth/useSession"
import { DiscordSection } from "@/components/DiscordSection"
import { EmptyState } from "@/components/EmptyState"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { LoadingPlaceholder } from "@/components/LoadingPlaceholder"
import { NicknameEditor } from "@/components/NicknameEditor"
import { UserProfileView } from "@/components/UserProfileView"

export function MePage() {
  const session = useSession()

  if (session.status === "loading") {
    return (
      <LeaderboardSection title="Me">
        <LoadingPlaceholder />
      </LeaderboardSection>
    )
  }

  if (session.status !== "signed-in") {
    return <EmptyState title="Not signed in" hint="Sign in with Better Lyrics from the header to see your stats." />
  }

  return (
    <div className="space-y-6">
      <UserProfileView keyId={session.identity.keyId} />
      <LeaderboardSection title="Nickname" subtitle="How you appear across Unison.">
        <NicknameEditor />
      </LeaderboardSection>
      <LeaderboardSection title="Discord" subtitle="Link your account for leaderboard roles.">
        <DiscordSection />
      </LeaderboardSection>
    </div>
  )
}
