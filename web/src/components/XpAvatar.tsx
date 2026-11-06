import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { levelHoleStyle, PROFILE_LEVEL_HOLE } from "@/lib/level-hole"

const RING_RADIUS = 47
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface XpAvatarProps {
  avatarUrl?: string | null
  keyId: string
  level?: number
  progress: number | null
  tiered: boolean
  className?: string
}

export function XpAvatar({ avatarUrl, keyId, level, progress, tiered, className }: XpAvatarProps) {
  return (
    <div className={cn("relative [container-type:size]", className)}>
      <div
        className="absolute inset-0"
        style={level === undefined ? undefined : levelHoleStyle(PROFILE_LEVEL_HOLE, level)}
      >
        <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="3" stroke="rgba(255,255,255,0.18)" />
          {progress ? (
            <circle
              cx="50"
              cy="50"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="3"
              stroke={tiered ? "#ffc83d" : "#f5f5f7"}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            />
          ) : null}
        </svg>
        <UserAvatar
          avatarUrl={avatarUrl}
          keyId={keyId}
          className="absolute inset-[8%] block size-[84%] rounded-full bg-unison-bg-elevated object-cover"
        />
      </div>
      {level === undefined ? null : (
        <span
          title={`Level ${level}`}
          className="absolute right-[2%] bottom-[2%] grid h-[22%] min-w-[22%] place-items-center rounded-full bg-unison-text px-[5%] text-[11.5cqw] font-black tabular-nums text-[#121116]"
        >
          {level}
        </span>
      )}
    </div>
  )
}
