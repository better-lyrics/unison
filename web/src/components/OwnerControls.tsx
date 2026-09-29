import { useSession } from "@/auth/useSession"
import { AvatarPicker } from "@/components/AvatarPicker"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { DiscordSection } from "@/components/DiscordSection"
import { NicknameEditor } from "@/components/NicknameEditor"
import { type DiscordLink, useDiscordLink } from "@/hooks/useDiscordLink"
import type { ReactNode } from "react"

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
      <OwnerSection title="Profile picture" subtitle="Pick how you appear across Unison.">
        <AvatarPicker discord={link} />
      </OwnerSection>
      <OwnerSection title="Nickname" subtitle="How you appear across Unison.">
        <NicknameEditor />
      </OwnerSection>
      <OwnerSection title="Discord" subtitle="Link your account for leaderboard roles.">
        <DiscordSection link={link} />
      </OwnerSection>
    </>
  )
}

function OwnerSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <CollapsibleSection title={title} defaultOpen={false}>
      <p className="mb-3 text-xs text-unison-text-muted">{subtitle}</p>
      {children}
    </CollapsibleSection>
  )
}
