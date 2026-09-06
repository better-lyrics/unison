import { IconBrandDiscordFilled } from "@tabler/icons-react"

export function DiscordBadge() {
  return (
    <span className="discord-badge inline-flex items-center gap-1 rounded-full py-0.5 pr-3 pl-2 text-[11px] font-medium">
      <IconBrandDiscordFilled className="size-3.5" />
      Connected
    </span>
  )
}
