import { useSession } from "@/auth/useSession"
import { AvatarPicker } from "@/components/AvatarPicker"
import { DiscordSection } from "@/components/DiscordSection"
import { LeaderboardSection } from "@/components/LeaderboardSection"
import { NicknameEditor } from "@/components/NicknameEditor"
import { type DiscordLink, useDiscordLink } from "@/hooks/useDiscordLink"

// The signed-in owner's editing controls, shown on their own profile wherever it renders.
export function OwnerControls() {
  const session = useSession()
  const discord = useDiscordLink()

  const link: DiscordLink = {
    ...discord,
    disconnect: async () => {
      const usingDiscordPhoto =
        session.status === "signed-in" &&
        discord.discordAvatarUrl !== null &&
        session.identity.avatarUrl === discord.discordAvatarUrl
      const disconnected = await discord.disconnect()
      if (disconnected && usingDiscordPhoto) session.updateAvatarUrl(null)
      return disconnected
    },
  }

  return (
    <>
      <LeaderboardSection title="Profile picture" subtitle="Pick how you appear across Unison.">
        <AvatarPicker discord={link} />
      </LeaderboardSection>
      <LeaderboardSection title="Nickname" subtitle="How you appear across Unison.">
        <NicknameEditor />
      </LeaderboardSection>
      <LeaderboardSection title="Discord" subtitle="Link your account for leaderboard roles.">
        <DiscordSection link={link} />
      </LeaderboardSection>
    </>
  )
}
