import { DiscordIcon } from "@/components/icons/DiscordIcon"
import { chipClass } from "@/components/ui"
import { cn } from "@/lib/cn"

export function DiscordChip({ id, username }: { id: string; username: string }) {
  return (
    <a
      href={`https://discord.com/users/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open Discord profile"
      className={cn(chipClass, "gap-[9px] pl-1")}
    >
      <span className="grid size-[22px] place-items-center rounded-md bg-[#5865f2] text-white [corner-shape:superellipse(1.6)]">
        <DiscordIcon className="size-3.5" />
      </span>
      {username}
    </a>
  )
}
