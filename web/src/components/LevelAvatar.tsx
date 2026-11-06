import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { levelHoleStyle, SONG_LEVEL_HOLE } from "@/lib/level-hole"

interface LevelAvatarProps {
  avatarUrl?: string | null
  keyId: string
  level: number
  className?: string
}

export function LevelAvatar({ avatarUrl, keyId, level, className }: LevelAvatarProps) {
  return (
    <div className={cn("relative size-[52px] shrink-0", className)}>
      <div className="absolute inset-0" style={levelHoleStyle(SONG_LEVEL_HOLE, level)}>
        <UserAvatar avatarUrl={avatarUrl} keyId={keyId} className="block size-full rounded-full object-cover" />
      </div>
      <span
        title={`Level ${level}`}
        className="absolute -right-[3px] -bottom-[3px] grid h-5 min-w-5 place-items-center rounded-full bg-unison-text px-[5px] text-[11px] font-black tabular-nums text-[#121116]"
      >
        {level}
      </span>
    </div>
  )
}
