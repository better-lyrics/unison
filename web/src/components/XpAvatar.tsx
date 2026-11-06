import { UserAvatar } from "@/components/UserAvatar"
import { cn } from "@/lib/cn"
import { type LevelHoleGeometry, levelHoleStyle, PROFILE_LEVEL_HOLE } from "@/lib/level-hole"

const RING_RADIUS = 47
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface XpAvatarProps {
  avatarUrl?: string | null
  keyId: string
  level?: number
  progress: number | null
  tiered: boolean
  hole?: LevelHoleGeometry
  className?: string
}

const PILL_TEXT = 0.52

function pillStyle({ box, pillHeight, pillWidth, offset }: LevelHoleGeometry) {
  const pct = (value: number) => `${(value / box) * 100}%`
  return {
    right: pct(offset),
    bottom: pct(offset),
    height: pct(pillHeight),
    minWidth: pct(pillWidth.narrow),
    fontSize: `${(pillHeight / box) * 100 * PILL_TEXT}cqw`,
  }
}

export function XpAvatar({
  avatarUrl,
  keyId,
  level,
  progress,
  tiered,
  hole = PROFILE_LEVEL_HOLE,
  className,
}: XpAvatarProps) {
  return (
    <div className={cn("relative [container-type:size]", className)}>
      <div
        className="absolute inset-0"
        style={level === undefined ? undefined : levelHoleStyle(hole, level)}
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
          className="absolute inset-[8%] block size-[84%] rounded-full bg-unison-bg-elevated object-cover outline outline-1 -outline-offset-1 outline-white/10"
        />
      </div>
      {level === undefined ? null : (
        <span
          title={`Level ${level}`}
          style={pillStyle(hole)}
          className="absolute grid place-items-center rounded-full bg-unison-text px-[5%] font-black tabular-nums text-[#121116]"
        >
          {level}
        </span>
      )}
    </div>
  )
}
