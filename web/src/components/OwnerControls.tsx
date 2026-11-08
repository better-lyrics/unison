import { useSession } from "@/auth/useSession"
import { AvatarPicker } from "@/components/AvatarPicker"
import { CollapsibleSection } from "@/components/CollapsibleSection"
import { DiscordSection } from "@/components/DiscordSection"
import { NicknameEditor } from "@/components/NicknameEditor"
import type { DiscordLink } from "@/hooks/useDiscordLink"
import { type ReactNode, useState } from "react"
import { putProfileSettings } from "@/lib/api"

// The signed-in owner's editing controls, shown on their own profile wherever it renders.
interface OwnerControlsProps {
  discord: DiscordLink
  discordRevealRequest: number
  showDiscord: boolean
  onProfileChange: () => Promise<void>
}

export function OwnerControls({ discord, discordRevealRequest, showDiscord, onProfileChange }: OwnerControlsProps) {
  const session = useSession()

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

  const [discordShown, setDiscordShown] = useState(showDiscord)
  const toggleDiscord = async (checked: boolean) => {
    setDiscordShown(checked)
    try {
      await putProfileSettings({ showDiscord: checked })
      await onProfileChange()
    } catch {
      setDiscordShown(!checked)
    }
  }

  return (
    <>
      <OwnerSection title="Profile picture" subtitle="Pick how you appear across Unison.">
        <AvatarPicker discord={link} />
      </OwnerSection>
      <OwnerSection title="Nickname" subtitle="How you appear across Unison.">
        <NicknameEditor />
      </OwnerSection>
      <OwnerSection
        title="Discord"
        subtitle="Link your account for leaderboard roles."
        revealRequest={discordRevealRequest}
      >
        <DiscordSection link={link} showOnProfile={{ checked: discordShown, onChange: toggleDiscord }} />
      </OwnerSection>
    </>
  )
}

function OwnerSection({
  title,
  subtitle,
  revealRequest,
  children,
}: {
  title: string
  subtitle: string
  revealRequest?: number
  children: ReactNode
}) {
  return (
    <CollapsibleSection title={title} defaultOpen={false} revealRequest={revealRequest} className="scroll-mt-8">
      <p className="mb-3 text-xs text-unison-text-muted">{subtitle}</p>
      {children}
    </CollapsibleSection>
  )
}
