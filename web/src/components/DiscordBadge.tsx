import { IconBrandDiscordFilled } from "@tabler/icons-react"

export function DiscordBadge() {
  return (
    <span className="discord-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
      <IconBrandDiscordFilled className="size-3.5" />
      Connected
    </span>
  )
}
